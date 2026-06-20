"""
Ingest a PDF or EPUB book into librerIA.

Usage:
    uv run ingest.py book.pdf
    uv run ingest.py book.epub --title "Dune" --author "Frank Herbert"
"""

import re
import json
import hashlib
from pathlib import Path
from typing import Optional

import click
import fitz  # PyMuPDF
import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup
from sentence_transformers import SentenceTransformer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn

from vector_store import get_vector_store
from storage import init_db, upsert_book, upsert_sections

console = Console()

BASE_DIR   = Path(__file__).parent
DB_DIR     = BASE_DIR / "db"
SECTIONS_DIR = DB_DIR / "sections"
BOOKS_FILE = DB_DIR / "books.json"

EMBED_MODEL    = "intfloat/multilingual-e5-large"
PASSAGE_PREFIX = "passage: "   # multilingual-e5 passage prefix
PASSAGE_WORDS  = 300   # ~400 tokens — small enough for precise retrieval
OVERLAP_WORDS = 50    # overlap keeps context across boundaries
SECTION_WORDS = 1500  # ~2 000 tokens — what the LLM actually reads


# ── Helpers ───────────────────────────────────────────────────────────────────

_SUPPORTED_LANGS = {"en", "es", "fr"}


def detect_language(chapters: list[dict]) -> str:
    """Detect book language from the first few chapters (fallback: 'en')."""
    try:
        from langdetect import detect
        sample = " ".join(ch["text"][:800] for ch in chapters[:4])
        lang = detect(sample)
        return lang if lang in _SUPPORTED_LANGS else "other"
    except Exception:
        return "en"


def setup_dirs():
    DB_DIR.mkdir(exist_ok=True)
    SECTIONS_DIR.mkdir(exist_ok=True)
    if not BOOKS_FILE.exists():
        BOOKS_FILE.write_text("[]")
    init_db()


def make_book_id(title: str, author: str) -> str:
    return hashlib.md5(f"{title}:{author}".encode()).hexdigest()[:12]


# ── PDF parsing ───────────────────────────────────────────────────────────────

def detect_body_size(doc: fitz.Document) -> float:
    from collections import Counter
    sizes = []
    for page in doc:
        for block in page.get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    if len(span["text"].strip()) > 10:
                        sizes.append(round(span["size"], 1))
    if not sizes:
        return 12.0
    return Counter(sizes).most_common(1)[0][0]


def parse_pdf(path: Path) -> tuple[str, str, list[dict]]:
    doc = fitz.open(str(path))
    meta = doc.metadata
    title  = meta.get("title") or path.stem
    author = meta.get("author") or "Unknown"

    body_size     = detect_body_size(doc)
    heading_min   = body_size * 1.25
    chapter_re    = re.compile(
        r'^(chapter|part|section|book|prologue|epilogue|introduction|conclusion|appendix)\b',
        re.IGNORECASE,
    )

    chapters = []
    current  = {"title": "Front Matter", "lines": [], "page_start": 1}

    for page_num, page in enumerate(doc, 1):
        for block in page.get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                text = " ".join(s["text"] for s in line["spans"]).strip()
                if not text:
                    continue

                max_size = max(s["size"] for s in line["spans"])
                is_bold  = any("bold" in s.get("font", "").lower() for s in line["spans"])
                is_heading = (
                    (max_size >= heading_min or (is_bold and max_size >= body_size))
                    and len(text) < 100
                    and not text.endswith((",", ";"))
                )
                is_chapter = bool(chapter_re.match(text))

                if (is_heading or is_chapter) and len(" ".join(current["lines"])) > 200:
                    current["page_end"] = page_num - 1
                    chapters.append(current)
                    current = {"title": text, "lines": [], "page_start": page_num}
                else:
                    current["lines"].append(text)

    current["page_end"] = len(doc)
    chapters.append(current)

    result = []
    for ch in chapters:
        text = "\n".join(ch["lines"])
        if len(text.split()) > 80:
            result.append({
                "title":      ch["title"],
                "text":       text,
                "page_start": ch["page_start"],
                "page_end":   ch.get("page_end"),
            })
    return title, author, result


# ── EPUB parsing ──────────────────────────────────────────────────────────────

def parse_epub(path: Path) -> tuple[str, str, list[dict]]:
    book = epub.read_epub(str(path))

    title_meta  = book.get_metadata("DC", "title")
    author_meta = book.get_metadata("DC", "creator")
    title  = title_meta[0][0]  if title_meta  else path.stem
    author = author_meta[0][0] if author_meta else "Unknown"

    chapters = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        soup    = BeautifulSoup(item.get_content(), "lxml")
        heading = soup.find(["h1", "h2"])
        ch_title = heading.get_text(strip=True) if heading else f"Section {len(chapters) + 1}"

        paragraphs = []
        for tag in soup.find_all(["p", "blockquote"]):
            t = tag.get_text(" ", strip=True)
            if t:
                paragraphs.append(t)

        text = "\n\n".join(paragraphs)
        if len(text.split()) > 80:
            chapters.append({
                "title":      ch_title,
                "text":       text,
                "page_start": None,
                "page_end":   None,
            })
    return title, author, chapters


# ── Chunking ──────────────────────────────────────────────────────────────────

def split_sections(text: str) -> list[str]:
    """Split chapter text into ~SECTION_WORDS-word sections, respecting paragraphs."""
    paras = [p.strip() for p in re.split(r'\n{2,}', text) if p.strip()]
    if not paras:
        paras = [s.strip() for s in text.splitlines() if s.strip()]

    sections, current, count = [], [], 0
    for para in paras:
        words = len(para.split())
        if count + words > SECTION_WORDS and current:
            sections.append("\n\n".join(current))
            current, count = [], 0
        current.append(para)
        count += words

    if current:
        sections.append("\n\n".join(current))

    return sections or [text]


def split_passages(text: str) -> list[str]:
    """Split section into overlapping passages of ~PASSAGE_WORDS words."""
    words = text.split()
    if len(words) <= PASSAGE_WORDS:
        return [text]

    passages, start = [], 0
    while start < len(words):
        end = min(start + PASSAGE_WORDS, len(words))
        passages.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start += PASSAGE_WORDS - OVERLAP_WORDS

    return passages


# ── Main ──────────────────────────────────────────────────────────────────────

@click.command()
@click.argument("book_path", type=click.Path(exists=True))
@click.option("--title",    default=None, help="Override auto-detected title")
@click.option("--author",   default=None, help="Override auto-detected author")
@click.option("--language", default=None, help="Language code: en · es · fr (auto-detected if omitted)")
def ingest(book_path: str, title: Optional[str], author: Optional[str], language: Optional[str]):
    """Parse a PDF or EPUB and index it into the librerIA vector store."""
    setup_dirs()
    path   = Path(book_path)
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        t, a, chapters = parse_pdf(path)
    elif suffix == ".epub":
        t, a, chapters = parse_epub(path)
    else:
        console.print(f"[red]Unsupported format '{suffix}'. Use .pdf or .epub[/]")
        return

    title    = title  or t
    author   = author or a
    bid      = make_book_id(title, author)
    language = language or detect_language(chapters)

    console.print(f"\n[bold cyan]librerIA — Ingest[/]")
    console.print(f"  Book    : [green]{title}[/] by [green]{author}[/]")
    console.print(f"  Language: [cyan]{language}[/]")
    console.print(f"  Chapters: {len(chapters)}")

    console.print(f"\n[bold]Loading embedding model[/] ({EMBED_MODEL})…")
    model = SentenceTransformer(EMBED_MODEL)

    vector_size = model.get_sentence_embedding_dimension() or 1024
    collection = get_vector_store(vector_size=vector_size)

    sections_file  = SECTIONS_DIR / f"{bid}.json"
    sections_store = json.loads(sections_file.read_text()) if sections_file.exists() else {}

    passage_ids, passage_texts, passage_metas = [], [], []

    with Progress(
        SpinnerColumn(), TextColumn("{task.description}"),
        BarColumn(), TaskProgressColumn(),
    ) as prog:
        task = prog.add_task("Chunking chapters…", total=len(chapters))
        for ch_idx, chapter in enumerate(chapters):
            for sec_idx, sec_text in enumerate(split_sections(chapter["text"])):
                sec_id = f"{bid}:ch{ch_idx}:s{sec_idx}"
                sections_store[sec_id] = sec_text

                for p_idx, passage in enumerate(split_passages(sec_text)):
                    passage_ids.append(f"{sec_id}:p{p_idx}")
                    passage_texts.append(passage)
                    passage_metas.append({
                        "book_id":       bid,
                        "book_title":    title,
                        "author":        author,
                        "chapter_num":   ch_idx,
                        "chapter_title": chapter["title"],
                        "section_id":    sec_id,
                        "page_start":    chapter.get("page_start") or 0,
                        "language":      language,
                    })
            prog.advance(task)

    console.print(f"\n[bold]Embedding {len(passage_texts)} passages…[/]")
    embeddings = model.encode(
        [PASSAGE_PREFIX + p for p in passage_texts],
        batch_size=32,
        show_progress_bar=True,
        normalize_embeddings=True,
    ).tolist()

    # Skip passages already in the store
    existing: set[str] = set()
    for i in range(0, len(passage_ids), 500):
        batch = passage_ids[i : i + 500]
        existing.update(collection.get(ids=batch)["ids"])

    new_idx = [i for i, pid in enumerate(passage_ids) if pid not in existing]
    if not new_idx:
        console.print("[yellow]All passages already indexed — nothing to add.[/]")
    else:
        for i in range(0, len(new_idx), 500):
            batch = new_idx[i : i + 500]
            collection.add(
                ids        = [passage_ids[j]  for j in batch],
                embeddings = [embeddings[j]   for j in batch],
                documents  = [passage_texts[j] for j in batch],
                metadatas  = [passage_metas[j] for j in batch],
            )
        console.print(f"  Added [green]{len(new_idx)}[/] new passages.")

    book = {
        "id":       bid,
        "title":    title,
        "author":   author,
        "language": language,
        "chapters": len(chapters),
        "passages": len(passage_ids),
        "file":     str(path.absolute()),
    }
    upsert_book(book)
    sections_file.write_text(json.dumps(sections_store, ensure_ascii=False, indent=2))
    upsert_sections(bid, sections_store, passage_metas)

    books = json.loads(BOOKS_FILE.read_text())
    books = [b for b in books if b["id"] != bid]
    books.append(book)
    BOOKS_FILE.write_text(json.dumps(books, indent=2))

    console.print(
        f"\n[bold green]✓ Done![/] "
        f"{len(passage_ids)} passages · {len(chapters)} chapters · ID [dim]{bid}[/]"
    )


if __name__ == "__main__":
    ingest()
