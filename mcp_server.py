"""
BookGraph MCP Server — exposes your book library as tools for Claude, ChatGPT, and Gemini.

── Add to Claude Desktop ─────────────────────────────────────────────────────
File: ~/Library/Application Support/Claude/claude_desktop_config.json

{
  "mcpServers": {
    "bookgraph": {
      "command": "uv",
      "args": ["--project", "/Users/ronnie/Documents/BookGraph", "run", "mcp_server.py"]
    }
  }
}

── Start manually ────────────────────────────────────────────────────────────
    uv run mcp_server.py
"""

import sys
from pathlib import Path

# Ensure query.py is importable regardless of the working directory
sys.path.insert(0, str(Path(__file__).parent))

from mcp.server.fastmcp import FastMCP
from sentence_transformers import SentenceTransformer, CrossEncoder

from query import (
    get_vector_collection,
    load_section,
    expand_queries,
    retrieve,
    EMBED_MODEL,
    RERANK_MODEL,
)
from llm import LLM
from storage import migrate_json_files, list_books as list_stored_books, get_chapter_sections

mcp = FastMCP("BookGraph")

# Models are loaded lazily — the first tool call triggers loading once.
_embed:  SentenceTransformer | None = None
_rerank: CrossEncoder         | None = None
_coll                                = None
_llm:    LLM | None                  = None


def _load():
    global _embed, _rerank, _coll, _llm
    if _embed is not None:
        return
    _embed  = SentenceTransformer(EMBED_MODEL)
    _rerank = CrossEncoder(RERANK_MODEL)
    vector_size = _embed.get_sentence_embedding_dimension() or 1024
    _coll = get_vector_collection(vector_size=vector_size)
    _llm = LLM()


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp.tool()
def search_books(query: str, book_title: str = "", top_k: int = 5) -> str:
    """
    Search your indexed book library for passages relevant to any question.

    This is your primary tool. Use it to answer questions about characters,
    relationships, plot, themes, quotes, and any other book content.

    Multi-query expansion and cross-encoder re-ranking are applied automatically
    to maximise retrieval quality — especially useful for complex questions like
    "who is connected to John and how" or "what motivates the antagonist".

    Args:
        query:      Your question or search phrase (natural language).
        book_title: Restrict search to one book (exact title from list_books).
                    Leave empty to search across the whole library.
        top_k:      Number of sections to return (1–10, default 5).
                    Raise to 8–10 for wide relationship or thematic questions.
    """
    _load()
    top_k  = max(1, min(top_k, 10))
    filter_book = book_title.strip() or None

    queries = [query]
    if _llm:
        try:
            queries = expand_queries(query, _llm)
        except Exception:
            pass

    contexts = retrieve(queries, _embed, _rerank, _coll, filter_book, top_k)

    if not contexts:
        return (
            "No relevant passages found. "
            "The library may be empty — run `uv run ingest.py <book>` to add books."
        )

    parts = []
    for i, ctx in enumerate(contexts, 1):
        pg   = f" (p. {ctx['page_start']})" if ctx["page_start"] else ""
        parts.append(
            f"[Source {i}]\n"
            f"Book: {ctx['book_title']} by {ctx['author']}\n"
            f"Chapter {ctx['chapter_num'] + 1}: {ctx['chapter_title']}{pg}\n"
            f"Relevance: {ctx['score']:.2f}\n\n"
            f"{ctx['section_text']}"
        )

    return ("\n\n" + "─" * 60 + "\n\n").join(parts)


@mcp.tool()
def list_books() -> str:
    """
    List all books currently indexed in the BookGraph library.

    Call this first to discover available titles before searching or
    retrieving chapters.
    """
    migrate_json_files()
    books = list_stored_books()
    if not books:
        return "No books indexed yet. Run: uv run ingest.py <path/to/book.pdf>"

    lines = ["BookGraph Library\n"]
    for b in books:
        lines.append(
            f"  • {b['title']}  —  {b['author']}\n"
            f"    {b['chapters']} chapters · {b['passages']} indexed passages\n"
            f"    ID: {b['id']}"
        )
    return "\n".join(lines)


@mcp.tool()
def get_chapter(book_title: str, chapter_num: int) -> str:
    """
    Retrieve the full reconstructed text of a specific chapter.

    Use this when you need to read an entire chapter in sequence, rather than
    searching for specific passages.

    Args:
        book_title:  Exact title as shown by list_books().
        chapter_num: 1-based chapter number.
    """
    migrate_json_files()
    books = list_stored_books()
    book  = next(
        (b for b in books if b["title"].lower() == book_title.lower()), None
    )
    if not book:
        avail = ", ".join(f'"{b["title"]}"' for b in books)
        return f'Book "{book_title}" not found. Available: {avail}'

    ch_idx     = chapter_num - 1
    ch_secs    = get_chapter_sections(book["id"], ch_idx)

    if not ch_secs:
        total = book.get("chapters") or 0
        return f"Chapter {chapter_num} not found. This book has {total} chapters."

    body = "\n\n".join(ch_secs)
    return f"[{book_title} — Chapter {chapter_num}]\n\n{body}"


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--http", action="store_true",
                        help="Run HTTP+SSE transport on port 9000 (for testing outside Claude Desktop)")
    args, _ = parser.parse_known_args()
    if args.http:
        mcp.run(transport="streamable-http", host="127.0.0.1", port=9000)
    else:
        # stdio mode — designed to be launched by Claude Desktop, not a terminal.
        # Bare-newline JSON errors in the terminal are expected; they disappear with a real client.
        mcp.run()
