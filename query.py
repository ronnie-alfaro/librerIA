"""
Query your librerIA library from the terminal.

Usage:
    uv run query.py "Who is connected to John and how?"
    uv run query.py "What drives the protagonist?" --book "Dune"
    uv run query.py "..." --top-k 8 --no-expand --show-sources
"""

import sys
from pathlib import Path
from typing import Optional, TYPE_CHECKING

import click
from sentence_transformers import SentenceTransformer, CrossEncoder
from rich.console import Console
from rich.panel import Panel
from rich.markdown import Markdown
from rich.table import Table

from vector_store import get_vector_store
from storage import (
    BOOKS_FILE,
    SECTIONS_DIR,
    get_retrieval_cache,
    hydrate_retrieval_results,
    load_section as load_section_from_db,
    load_sections_batch as load_sections_batch_from_db,
    make_retrieval_cache_key,
    set_retrieval_cache,
)

if TYPE_CHECKING:
    from llm import LLM

console = Console()

BASE_DIR     = Path(__file__).parent
DB_DIR       = BASE_DIR / "db"

EMBED_MODEL    = "intfloat/multilingual-e5-large"
RERANK_MODEL   = "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1"
PASSAGE_PREFIX = "passage: "   # prepended when indexing passages
BGE_PREFIX     = "query: "     # prepended when encoding a query

SYSTEM_PROMPT = """\
You are a meticulous literary analyst. Answer questions about the book passages provided below.

Rules:
- Respond entirely in Spanish, regardless of the question language or the book language.
- For character/relationship questions: identify EVERY person mentioned in relation to the subject,
  describe each relationship precisely (ally, enemy, family, mentor, rival…), and note how it evolves.
- For thematic or conceptual questions: draw specific textual evidence from the passages.
- Always cite sources using [Fuente N] notation, referencing chapter and book.
- Structure complex answers with clear sections or bullet points.
- If the context is insufficient, state exactly what is missing rather than speculating.\
"""


# ── Shared retrieval helpers (also imported by mcp_server.py) ─────────────────

def get_vector_collection(vector_size: int = 1024):
    return get_vector_store(vector_size=vector_size)


def load_section(section_id: str) -> Optional[str]:
    return load_section_from_db(section_id)


def load_sections_batch(section_ids: list[str]) -> dict[str, str]:
    """Load multiple sections in one read per book file instead of one read per section."""
    return load_sections_batch_from_db(section_ids)


def expand_queries(question: str, llm: "LLM") -> list[str]:
    """Use the configured LLM to generate 3 alternative retrieval queries."""
    try:
        result = llm.chat_sync(
            messages=[{
                "role": "user",
                "content": (
                    "Genera 3 consultas cortas alternativas para encontrar pasajes relevantes del libro "
                    "para esta pregunta. Devuelve solo las consultas, una por línea, sin números.\n\n"
                    f"Question: {question}"
                ),
            }],
            max_tokens=160,
            model=llm.expand_model,
        )
        lines = [l.strip() for l in result.strip().splitlines() if l.strip()]
        return [question] + lines[:3]
    except Exception:
        return [question]


def retrieve(
    queries: list[str],
    embed_model: SentenceTransformer,
    reranker: CrossEncoder,
    collection,
    book_title: Optional[str],
    top_k: int,
    book_id: Optional[str] = None,
) -> list[dict]:
    """
    Multi-query semantic retrieval + cross-encoder re-ranking.

    Strategy:
      1. Embed each query (with BGE instruction prefix).
      2. Retrieve up to 4×top_k candidate passages per query.
      3. Deduplicate by section — keep the closest passage match per section.
      4. Re-rank sections with a cross-encoder against the original question.
      5. Return the top_k highest-scoring sections (each ~1 500 words of context).
    """
    where = {"book_id": book_id} if book_id else ({"book_title": book_title} if book_title else None)
    vector_store_name = getattr(collection, "name", collection.__class__.__name__)
    cache_key = make_retrieval_cache_key(
        queries=queries,
        book_title=book_title,
        top_k=top_k,
        embed_model=EMBED_MODEL,
        rerank_model=RERANK_MODEL,
        vector_store=vector_store_name,
        book_id=book_id,
    )
    cached = get_retrieval_cache(cache_key)
    if cached:
        hydrated = hydrate_retrieval_results(cached)
        if hydrated:
            return hydrated[:top_k]

    # Pass 1: collect best distance and metadata per unique section_id
    best: dict[str, tuple[float, dict]] = {}   # sec_id -> (dist, meta)

    for q in queries:
        q_emb = embed_model.encode(
            BGE_PREFIX + q, normalize_embeddings=True
        ).tolist()

        results = collection.query(
            query_embeddings=[q_emb],
            n_results=min(top_k * 4, 40),
            where=where,
            include=["metadatas", "distances"],
        )

        for meta, dist in zip(results["metadatas"][0], results["distances"][0]):
            sec_id = meta["section_id"]
            if sec_id not in best or dist < best[sec_id][0]:
                best[sec_id] = (dist, meta)

    if not best:
        return []

    # Pass 2: batch-load section texts (one file read per book, not per section)
    texts = load_sections_batch(list(best.keys()))

    candidates = []
    for sec_id, (dist, meta) in best.items():
        sec_text = texts.get(sec_id)
        if not sec_text:
            continue
        candidates.append({
            "section_id":    sec_id,
            "section_text":  sec_text,
            "chapter_title": meta["chapter_title"],
            "chapter_num":   meta["chapter_num"],
            "book_title":    meta["book_title"],
            "author":        meta["author"],
            "page_start":    meta.get("page_start", 0),
            "_best_dist":    dist,
        })

    if not candidates:
        return []

    original     = queries[0]
    rerank_pairs = [(original, c["section_text"][:600]) for c in candidates]
    scores       = reranker.predict(rerank_pairs)

    for c, score in zip(candidates, scores):
        c["score"] = float(score)

    candidates.sort(key=lambda x: x["score"], reverse=True)
    results = candidates[:top_k]
    set_retrieval_cache(
        key=cache_key,
        queries=queries,
        results=results,
        book_title=book_title,
        top_k=top_k,
        embed_model=EMBED_MODEL,
        rerank_model=RERANK_MODEL,
        vector_store=vector_store_name,
        book_id=book_id,
    )
    return results


# ── Answer generation ─────────────────────────────────────────────────────────

def build_context_block(contexts: list[dict]) -> str:
    parts = []
    for i, ctx in enumerate(contexts, 1):
        parts.append(
            f"[Fuente {i}: {ctx['book_title']} — "
            f"Capítulo {ctx['chapter_num'] + 1}: {ctx['chapter_title']}]\n\n"
            f"{ctx['section_text']}"
        )
    return "\n\n" + ("─" * 60 + "\n\n").join(parts)


def answer(question: str, contexts: list[dict], llm: "LLM") -> str:
    return llm.chat_sync(
        messages=[{
            "role": "user",
            "content": (
                f"Passages from the book:\n\n{build_context_block(contexts)}"
                f"\n\n{'─' * 60}\n\nQuestion: {question}"
            ),
        }],
        system=SYSTEM_PROMPT + "\n- Use natural, fluent Spanish with clear sections when useful.",
        max_tokens=2048,
    )


# ── CLI ───────────────────────────────────────────────────────────────────────

@click.command()
@click.argument("question")
@click.option("--book",         default=None, help="Filter to a specific book (exact title)")
@click.option("--top-k",        default=5,    help="Sections to retrieve (default 5)")
@click.option("--no-expand",    is_flag=True, help="Skip multi-query expansion")
@click.option("--show-sources", is_flag=True, help="Print retrieved passages before the answer")
def query(
    question:     str,
    book:         Optional[str],
    top_k:        int,
    no_expand:    bool,
    show_sources: bool,
):
    """Ask a question about your indexed books."""
    from llm import LLM, fit_contexts
    llm = LLM()
    ok, err = llm.verify()
    if not ok:
        console.print(f"[red]{err}[/]")
        sys.exit(1)

    console.print(f"\n[bold cyan]librerIA Query[/]  [dim]({llm.provider} · {llm.answer_model})[/]")
    console.print(f"  [italic]{question}[/]")
    if book:
        console.print(f"  Filter → [green]{book}[/]")

    with console.status("Loading models…"):
        embed_model = SentenceTransformer(EMBED_MODEL)
        reranker    = CrossEncoder(RERANK_MODEL)
        try:
            vector_size = embed_model.get_sentence_embedding_dimension() or 1024
            collection = get_vector_collection(vector_size=vector_size)
        except Exception as e:
            console.print(f"[red]Vector store error: {e}[/]")
            sys.exit(1)

    queries = [question]
    if not no_expand:
        with console.status("Expanding query…"):
            queries = expand_queries(question, llm)
        console.print(f"  Queries: {len(queries)}  (1 original + {len(queries)-1} expansions)")

    with console.status(f"Searching {len(queries)} queries…"):
        contexts = retrieve(queries, embed_model, reranker, collection, book, top_k)

    if not contexts:
        console.print(
            "[yellow]No passages found. "
            "Have you run ingest.py on a book yet?[/]"
        )
        return

    contexts, dropped = fit_contexts(contexts, llm.context_limit,
                                      system=SYSTEM_PROMPT, question=question)
    if dropped:
        console.print(
            f"  [yellow]Context window ({llm.context_limit} tokens): "
            f"dropped {dropped} section(s) to fit.[/]"
        )

    if show_sources:
        tbl = Table(title="Retrieved Sources", show_lines=True)
        tbl.add_column("Score", style="cyan",  width=6)
        tbl.add_column("Book",  style="green")
        tbl.add_column("Chapter")
        tbl.add_column("Excerpt", max_width=55)
        for ctx in contexts:
            tbl.add_row(
                f"{ctx['score']:.2f}",
                ctx["book_title"],
                f"Ch.{ctx['chapter_num']+1}: {ctx['chapter_title']}",
                ctx["section_text"][:100] + "…",
            )
        console.print(tbl)

    with console.status("Generating answer…"):
        reply = answer(question, contexts, llm)

    console.print()
    console.print(Panel(
        Markdown(reply),
        title=f"[bold]Answer[/] — {len(contexts)} sources",
        border_style="green",
    ))

    console.print("\n[dim]Sources:[/]")
    for i, ctx in enumerate(contexts, 1):
        pg = f"  (p.{ctx['page_start']})" if ctx["page_start"] else ""
        console.print(
            f"  [{i}] {ctx['book_title']} — "
            f"Ch.{ctx['chapter_num']+1}: {ctx['chapter_title']}{pg}"
        )


if __name__ == "__main__":
    query()
