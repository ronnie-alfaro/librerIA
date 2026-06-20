"""
SQLite storage for BookGraph metadata, sections, and JSON analysis caches.

Vectors live in Qdrant/Chroma. SQLite stores the structured app state and JSON
payloads that used to live as many small files under db/.
"""

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

BASE_DIR = Path(__file__).parent
DB_DIR = BASE_DIR / "db"
SQLITE_FILE = DB_DIR / "bookgraph.db"
BOOKS_FILE = DB_DIR / "books.json"
SECTIONS_DIR = DB_DIR / "sections"
MAPS_DIR = DB_DIR / "maps"
PROFILES_DIR = DB_DIR / "profiles"
SUMMARIES_DIR = DB_DIR / "summaries"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DB_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(SQLITE_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS books (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              author TEXT NOT NULL,
              language TEXT NOT NULL DEFAULT 'en',
              chapters INTEGER NOT NULL DEFAULT 0,
              passages INTEGER NOT NULL DEFAULT 0,
              file TEXT,
              extra_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sections (
              section_id TEXT PRIMARY KEY,
              book_id TEXT NOT NULL,
              chapter_num INTEGER NOT NULL,
              chapter_title TEXT NOT NULL,
              text TEXT NOT NULL,
              page_start INTEGER NOT NULL DEFAULT 0,
              word_count INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_sections_book_chapter
              ON sections(book_id, chapter_num);

            CREATE TABLE IF NOT EXISTS analysis_cache (
              key TEXT PRIMARY KEY,
              book_id TEXT NOT NULL,
              type TEXT NOT NULL,
              subject TEXT NOT NULL DEFAULT '',
              payload JSON NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_analysis_cache_book_type
              ON analysis_cache(book_id, type);

            CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_cache_unique
              ON analysis_cache(book_id, type, subject);

            CREATE TABLE IF NOT EXISTS retrieval_cache (
              key TEXT PRIMARY KEY,
              book_id TEXT,
              book_title TEXT,
              top_k INTEGER NOT NULL,
              embed_model TEXT NOT NULL,
              rerank_model TEXT NOT NULL,
              vector_store TEXT NOT NULL,
              queries_json TEXT NOT NULL,
              payload JSON NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_retrieval_cache_scope
              ON retrieval_cache(book_id, book_title, top_k);
            """
        )


def migrate_json_files() -> None:
    init_db()
    if BOOKS_FILE.exists():
        try:
            for book in json.loads(BOOKS_FILE.read_text()):
                upsert_book(book)
        except Exception:
            pass

    for sf in sorted(SECTIONS_DIR.glob("*.json")):
        book_id = sf.stem
        try:
            store = json.loads(sf.read_text())
        except Exception:
            continue
        upsert_sections(book_id, store)

    for mf in sorted(MAPS_DIR.glob("*.json")):
        try:
            if not has_analysis_cache(mf.stem, "character_map"):
                set_analysis_cache(mf.stem, "character_map", json.loads(mf.read_text()))
        except Exception:
            pass

    for book_dir in sorted(PROFILES_DIR.glob("*")):
        if not book_dir.is_dir():
            continue
        for pf in sorted(book_dir.glob("*.json")):
            try:
                payload = json.loads(pf.read_text())
                if not has_analysis_cache(book_dir.name, "character_profile", pf.stem):
                    set_analysis_cache(book_dir.name, "character_profile", payload, pf.stem)
            except Exception:
                pass

    for book_dir in sorted(SUMMARIES_DIR.glob("*")):
        if not book_dir.is_dir():
            continue
        for sf in sorted(book_dir.glob("ch*.json")):
            try:
                if not has_analysis_cache(book_dir.name, "chapter_summary", sf.stem):
                    set_analysis_cache(book_dir.name, "chapter_summary", json.loads(sf.read_text()), sf.stem)
            except Exception:
                pass


def list_books() -> list[dict[str, Any]]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, title, author, language, chapters, passages, file, extra_json FROM books ORDER BY title"
        ).fetchall()
    return [_book_from_row(row) for row in rows]


def get_book(book_id: str) -> Optional[dict[str, Any]]:
    init_db()
    with connect() as conn:
        row = conn.execute(
            "SELECT id, title, author, language, chapters, passages, file, extra_json FROM books WHERE id = ?",
            (book_id,),
        ).fetchone()
    return _book_from_row(row) if row else None


def upsert_book(book: dict[str, Any]) -> None:
    init_db()
    now = _now()
    extra = {
        key: value
        for key, value in book.items()
        if key not in {"id", "title", "author", "language", "chapters", "passages", "file"}
    }
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO books (id, title, author, language, chapters, passages, file, extra_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              author = excluded.author,
              language = excluded.language,
              chapters = excluded.chapters,
              passages = excluded.passages,
              file = COALESCE(excluded.file, books.file),
              extra_json = excluded.extra_json,
              updated_at = excluded.updated_at
            """,
            (
                book["id"],
                book.get("title") or "Untitled",
                book.get("author") or "Unknown",
                book.get("language") or "en",
                int(book.get("chapters") or 0),
                int(book.get("passages") or 0),
                book.get("file"),
                json.dumps(extra, ensure_ascii=False),
                now,
                now,
            ),
        )


def delete_book(book_id: str) -> None:
    init_db()
    with connect() as conn:
        conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
        conn.execute("DELETE FROM retrieval_cache WHERE book_id = ?", (book_id,))


def upsert_sections(book_id: str, sections: dict[str, str], passage_metas: Optional[list[dict[str, Any]]] = None) -> None:
    init_db()
    now = _now()
    meta_by_section: dict[str, dict[str, Any]] = {}
    for meta in passage_metas or []:
        sid = meta.get("section_id")
        if sid and sid not in meta_by_section:
            meta_by_section[sid] = meta

    rows = []
    for section_id, text in sections.items():
        meta = meta_by_section.get(section_id, {})
        chapter_num = meta.get("chapter_num")
        if chapter_num is None:
            chapter_num = _chapter_num_from_section_id(section_id)
        rows.append(
            (
                section_id,
                book_id,
                int(chapter_num or 0),
                meta.get("chapter_title") or f"Chapter {int(chapter_num or 0) + 1}",
                text,
                int(meta.get("page_start") or 0),
                len(text.split()),
                now,
                now,
            )
        )

    with connect() as conn:
        conn.execute(
            """
            DELETE FROM retrieval_cache
            WHERE book_id = ?
               OR book_title = (SELECT title FROM books WHERE id = ?)
               OR (book_id IS NULL AND book_title IS NULL)
            """,
            (book_id, book_id),
        )
        conn.executemany(
            """
            INSERT INTO sections
              (section_id, book_id, chapter_num, chapter_title, text, page_start, word_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(section_id) DO UPDATE SET
              book_id = excluded.book_id,
              chapter_num = excluded.chapter_num,
              chapter_title = excluded.chapter_title,
              text = excluded.text,
              page_start = excluded.page_start,
              word_count = excluded.word_count,
              updated_at = excluded.updated_at
            """,
            rows,
        )


def load_section(section_id: str) -> Optional[str]:
    init_db()
    with connect() as conn:
        row = conn.execute("SELECT text FROM sections WHERE section_id = ?", (section_id,)).fetchone()
    if row:
        return row["text"]
    return _load_section_json_fallback(section_id)


def load_sections_batch(section_ids: list[str]) -> dict[str, str]:
    if not section_ids:
        return {}
    init_db()
    placeholders = ",".join("?" for _ in section_ids)
    with connect() as conn:
        rows = conn.execute(
            f"SELECT section_id, text FROM sections WHERE section_id IN ({placeholders})",
            section_ids,
        ).fetchall()
    result = {row["section_id"]: row["text"] for row in rows}
    missing = [sid for sid in section_ids if sid not in result]
    if missing:
        result.update(_load_sections_json_fallback(missing))
    return result


def get_book_sections(book_id: str) -> list[dict[str, Any]]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT section_id, chapter_num, chapter_title, text, page_start, word_count
            FROM sections
            WHERE book_id = ?
            ORDER BY chapter_num, section_id
            """,
            (book_id,),
        ).fetchall()
    if rows:
        return [dict(row) for row in rows]
    return _book_sections_json_fallback(book_id)


def get_chapters(book_id: str) -> list[dict[str, Any]]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT chapter_num, MIN(chapter_title) AS title, COUNT(*) AS sections
            FROM sections
            WHERE book_id = ?
            GROUP BY chapter_num
            ORDER BY chapter_num
            """,
            (book_id,),
        ).fetchall()
    return [
        {"num": row["chapter_num"], "title": row["title"] or f"Chapter {row['chapter_num'] + 1}", "sections": row["sections"]}
        for row in rows
    ]


def get_chapter_sections(book_id: str, chapter_num: int) -> list[str]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT text FROM sections
            WHERE book_id = ? AND chapter_num = ?
            ORDER BY section_id
            """,
            (book_id, chapter_num),
        ).fetchall()
    return [row["text"] for row in rows]


def get_chapter_title(book_id: str, chapter_num: int) -> Optional[str]:
    init_db()
    with connect() as conn:
        row = conn.execute(
            """
            SELECT chapter_title FROM sections
            WHERE book_id = ? AND chapter_num = ?
            ORDER BY section_id
            LIMIT 1
            """,
            (book_id, chapter_num),
        ).fetchone()
    return row["chapter_title"] if row else None


def cache_key(book_id: str, cache_type: str, subject: str = "") -> str:
    return f"{book_id}:{cache_type}:{subject}"


def get_analysis_cache(book_id: str, cache_type: str, subject: str = "") -> Optional[dict[str, Any]]:
    init_db()
    with connect() as conn:
        row = conn.execute(
            "SELECT payload FROM analysis_cache WHERE book_id = ? AND type = ? AND subject = ?",
            (book_id, cache_type, subject),
        ).fetchone()
    return json.loads(row["payload"]) if row else None


def set_analysis_cache(book_id: str, cache_type: str, payload: dict[str, Any], subject: str = "") -> None:
    init_db()
    now = _now()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO analysis_cache (key, book_id, type, subject, payload, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(book_id, type, subject) DO UPDATE SET
              payload = excluded.payload,
              updated_at = excluded.updated_at
            """,
            (
                cache_key(book_id, cache_type, subject),
                book_id,
                cache_type,
                subject,
                json.dumps(payload, ensure_ascii=False),
                now,
                now,
            ),
        )


def has_analysis_cache(book_id: str, cache_type: str, subject: str = "") -> bool:
    init_db()
    with connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM analysis_cache WHERE book_id = ? AND type = ? AND subject = ? LIMIT 1",
            (book_id, cache_type, subject),
        ).fetchone()
    return bool(row)


def list_profile_caches(book_id: str) -> list[dict[str, str]]:
    init_db()
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT subject, payload FROM analysis_cache
            WHERE book_id = ? AND type = 'character_profile'
            ORDER BY subject
            """,
            (book_id,),
        ).fetchall()
    profiles = []
    for row in rows:
        try:
            payload = json.loads(row["payload"])
        except Exception:
            payload = {}
        profiles.append({"id": row["subject"], "name": payload.get("name") or row["subject"]})
    return profiles


def make_retrieval_cache_key(
    queries: list[str],
    book_title: Optional[str],
    top_k: int,
    embed_model: str,
    rerank_model: str,
    vector_store: str,
    book_id: Optional[str] = None,
) -> str:
    normalized = {
        "queries": [_normalize_query(query) for query in queries],
        "book_id": book_id or "",
        "book_title": _normalize_query(book_title or ""),
        "top_k": int(top_k),
        "embed_model": embed_model,
        "rerank_model": rerank_model,
        "vector_store": vector_store,
    }
    raw = json.dumps(normalized, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def get_retrieval_cache(key: str) -> Optional[list[dict[str, Any]]]:
    init_db()
    with connect() as conn:
        row = conn.execute("SELECT payload FROM retrieval_cache WHERE key = ?", (key,)).fetchone()
    if not row:
        return None
    try:
        payload = json.loads(row["payload"])
    except Exception:
        return None
    return payload.get("results") if isinstance(payload, dict) else None


def set_retrieval_cache(
    key: str,
    queries: list[str],
    results: list[dict[str, Any]],
    book_title: Optional[str],
    top_k: int,
    embed_model: str,
    rerank_model: str,
    vector_store: str,
    book_id: Optional[str] = None,
) -> None:
    init_db()
    now = _now()
    payload = {
        "results": [
            {"section_id": item["section_id"], "score": float(item.get("score", 0.0))}
            for item in results
        ]
    }
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO retrieval_cache
              (key, book_id, book_title, top_k, embed_model, rerank_model, vector_store, queries_json, payload, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              payload = excluded.payload,
              updated_at = excluded.updated_at
            """,
            (
                key,
                book_id,
                book_title,
                int(top_k),
                embed_model,
                rerank_model,
                vector_store,
                json.dumps([_normalize_query(query) for query in queries], ensure_ascii=False),
                json.dumps(payload, ensure_ascii=False),
                now,
                now,
            ),
        )


def hydrate_retrieval_results(cached: list[dict[str, Any]]) -> list[dict[str, Any]]:
    section_ids = [item.get("section_id", "") for item in cached if item.get("section_id")]
    sections = get_sections_by_ids(section_ids)
    results = []
    for item in cached:
        section = sections.get(item.get("section_id", ""))
        if not section:
            continue
        results.append({
            "section_id": section["section_id"],
            "section_text": section["text"],
            "chapter_title": section["chapter_title"],
            "chapter_num": section["chapter_num"],
            "book_title": section["book_title"],
            "author": section["author"],
            "page_start": section.get("page_start") or 0,
            "score": float(item.get("score", 0.0)),
            "_cached": True,
        })
    return results


def get_sections_by_ids(section_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not section_ids:
        return {}
    init_db()
    placeholders = ",".join("?" for _ in section_ids)
    with connect() as conn:
        rows = conn.execute(
            f"""
            SELECT
              sections.section_id,
              sections.text,
              sections.chapter_num,
              sections.chapter_title,
              sections.page_start,
              books.title AS book_title,
              books.author AS author
            FROM sections
            JOIN books ON books.id = sections.book_id
            WHERE sections.section_id IN ({placeholders})
            """,
            section_ids,
        ).fetchall()
    return {row["section_id"]: dict(row) for row in rows}


def _normalize_query(query: str) -> str:
    return " ".join((query or "").strip().lower().split())


def _book_from_row(row: sqlite3.Row) -> dict[str, Any]:
    book = {
        "id": row["id"],
        "title": row["title"],
        "author": row["author"],
        "language": row["language"],
        "chapters": row["chapters"],
        "passages": row["passages"],
    }
    if row["file"]:
        book["file"] = row["file"]
    try:
        book.update(json.loads(row["extra_json"] or "{}"))
    except Exception:
        pass
    return book


def _chapter_num_from_section_id(section_id: str) -> int:
    try:
        return int(section_id.split(":")[1][2:])
    except (IndexError, ValueError):
        return 0


def _load_section_json_fallback(section_id: str) -> Optional[str]:
    book_id = section_id.split(":")[0]
    sf = SECTIONS_DIR / f"{book_id}.json"
    if not sf.exists():
        return None
    try:
        return json.loads(sf.read_text()).get(section_id)
    except Exception:
        return None


def _load_sections_json_fallback(section_ids: list[str]) -> dict[str, str]:
    by_book: dict[str, list[str]] = {}
    for sid in section_ids:
        by_book.setdefault(sid.split(":")[0], []).append(sid)
    result: dict[str, str] = {}
    for book_id, sids in by_book.items():
        sf = SECTIONS_DIR / f"{book_id}.json"
        if not sf.exists():
            continue
        try:
            store = json.loads(sf.read_text())
        except Exception:
            continue
        for sid in sids:
            if sid in store:
                result[sid] = store[sid]
    return result


def _book_sections_json_fallback(book_id: str) -> list[dict[str, Any]]:
    sf = SECTIONS_DIR / f"{book_id}.json"
    if not sf.exists():
        return []
    try:
        store = json.loads(sf.read_text())
    except Exception:
        return []
    sections = []
    for section_id, text in sorted(store.items()):
        chapter_num = _chapter_num_from_section_id(section_id)
        sections.append({
            "section_id": section_id,
            "chapter_num": chapter_num,
            "chapter_title": f"Chapter {chapter_num + 1}",
            "text": text,
            "page_start": 0,
            "word_count": len(text.split()),
        })
    return sections
