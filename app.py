"""
librerIA Web App

Usage:
    uv run app.py        →  http://localhost:8000
"""

import re
import sys
import json
import shutil
import asyncio
import hashlib
import tempfile
import unicodedata
from uuid import uuid4
from pathlib import Path
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request, Response
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sentence_transformers import SentenceTransformer, CrossEncoder

sys.path.insert(0, str(Path(__file__).parent))
from ingest import (
    parse_pdf, parse_epub, split_sections, split_passages,
    make_book_id, setup_dirs, detect_language,
    EMBED_MODEL, PASSAGE_PREFIX, BOOKS_FILE, SECTIONS_DIR,
)
from query import (
    get_vector_collection, load_section, expand_queries, retrieve,
    build_context_block, RERANK_MODEL, SYSTEM_PROMPT,
)
from llm import LLM, load_config, save_config, fit_contexts, list_available_models
from storage import (
    init_db,
    migrate_json_files,
    list_books,
    get_book,
    upsert_book,
    upsert_sections,
    delete_book as delete_book_record,
    get_book_sections,
    get_chapters,
    get_chapter_sections,
    get_chapter_title,
    get_analysis_cache,
    set_analysis_cache,
    has_analysis_cache,
    list_profile_caches,
)

BASE_DIR      = Path(__file__).parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
MAPS_DIR      = BASE_DIR / "db" / "maps"
COVERS_DIR    = BASE_DIR / "db" / "covers"
PROFILES_DIR  = BASE_DIR / "db" / "profiles"
SUMMARIES_DIR = BASE_DIR / "db" / "summaries"
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024

def _load_books() -> list:
    return list_books()

def _save_books(books: list) -> None:
    for book in books:
        upsert_book(book)
    BOOKS_FILE.write_text(json.dumps(books, indent=2))

# ── Prompts ───────────────────────────────────────────────────────────────────

_MAP_PROMPT = """\
Extract characters and relationships from the passages below.
Return ONLY valid JSON — no markdown, no explanation, nothing else.

{
  "characters": [
    {"id": "snake_case_id", "name": "Full Name",
     "role": "protagonist|antagonist|supporting|minor",
     "description": "one sentence, max 12 words"}
  ],
  "relationships": [
    {"from": "id1", "to": "id2",
     "type": "family|ally|enemy|romantic|mentor|rival|neutral",
     "label": "2-4 words"}
  ],
  "events": [
    {"title": "Short title, max 5 words",
     "description": "one sentence, max 20 words",
     "type": "battle|death|romance|betrayal|discovery|meeting|journey|ceremony|political|transformation|conflict|other",
     "characters": ["id1"],
     "is_climax": false,
     "is_resolution": false,
     "is_epilogue": false}
  ]
}

Rules:
- Include EVERY named character found in the passages — do not omit anyone.
- Max 25 characters total; named people only.
- Every id in relationships must exist in the characters list.
- Include ALL relationships visible in the passages; do not omit connections.
- If two named characters appear in the same passage, that is at minimum a "neutral" relationship — include it.
- Descriptions max 20 words. Labels max 4 words. Event titles max 5 words.
- Extract 10–20 key events in narrative (chronological) order — more is better; cover the full arc from beginning through climax to resolution.
- You MUST include the climactic turning point (set is_climax:true) and the final resolution (set is_resolution:true); these are mandatory.
- If the book has an epilogue or a post-resolution scene, include it as a separate event with is_epilogue:true.
- Do not stop at the middle of the story — the final events in the passages are as important as the opening ones.
- Choose the most accurate event type from the allowed list.\
"""

_DISCOVER_PROMPT = """\
List every named individual (person) mentioned in the passages below.
Return ONLY a JSON array — no markdown, no explanation.

[{"id": "snake_case_id", "name": "Full Name"}]

Rules:
- Include every named person regardless of how minor their role.
- Do not include places, organisations, or unnamed characters.
- Use snake_case for id (lower case, spaces to underscores).\
"""

_SECTION_GRAPH_PROMPT = """\
Extract a local character graph from this book section.
Return ONLY valid JSON — no markdown, no explanation.

{
  "characters": [
    {"name": "Full Name",
     "aliases": ["alternate name"],
     "role": "protagonist|antagonist|supporting|minor",
     "description": "one sentence, max 14 words"}
  ],
  "relationships": [
    {"from": "Full Name", "to": "Full Name",
     "type": "family|ally|enemy|romantic|mentor|rival|neutral",
     "label": "2-4 words",
     "evidence": "short reason from this section, max 18 words"}
  ],
  "events": [
    {"title": "Short title, max 5 words",
     "description": "one sentence, max 20 words",
     "type": "battle|death|romance|betrayal|discovery|meeting|journey|ceremony|political|transformation|conflict|other",
     "characters": ["Full Name"],
     "is_climax": false,
     "is_resolution": false,
     "is_epilogue": false}
  ]
}

Rules:
- Extract only named people present in this section.
- Include minor characters if named.
- Include every explicit relationship visible in this section.
- If two named characters interact or are discussed together, include at least a neutral relationship.
- Do not invent facts outside this section.\
"""

_CHART_PROMPT = """\
Create a comprehensive character profile for **{name}** from the provided passages.

Use exactly these ## section headings in this order:

## Identity
## Personality & Motivation
## Background
## Relationships
Format each relationship as a bullet: **Name** — description of the connection
## Character Arc
## Key Moments
Number each item. Start with a **bold scene title**, then one sentence.
## Notable Quotes
Format every quote as a blockquote: > "text" — chapter or context

Be specific. Cite chapter or section where relevant. Do not speculate beyond the text.\
"""

_RELATION_PROMPT = """\
Analyze the relationship between **{name_a}** and **{name_b}** from the passages below.

Use exactly these ## section headings in this order:

## How They Met
## Dynamic & Power Balance
## Key Scenes Together
Number each scene: **Bold scene title.** One sentence description.
## How It Evolved
## Tension & Current Status
One or two sentences on where the relationship stands and the underlying tension.

Be specific. Cite chapter or section where relevant. Do not speculate beyond the text.\
"""

_CHAPTER_PROMPT = """\
Write a comprehensive summary for Chapter {num}: **{title}**.

Use exactly these ## section headings in this order:

## Overview
One paragraph: what happens, the key stakes, and why this chapter matters.

## Key Events
Number each event. Start with a **bold title**, then one sentence.

## Character Moments
Bullet list. **Character Name** — what they do, reveal, or how they develop.

## Themes & Tone
One paragraph on the dominant themes and emotional register.

Be specific. Quote or paraphrase meaningful lines where relevant. Do not speculate beyond the text.\
"""

# ── Globals ───────────────────────────────────────────────��───────────────────

_g: dict = {}
_jobs: dict[str, asyncio.Queue] = {}

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _safe_name(s: str) -> str:
    """Filesystem-safe slug for character names used as profile filenames."""
    return re.sub(r"[^\w\-]", "_", s.strip().lower())[:60] or "character"


def _fetch_google_cover(title: str, author: str) -> bytes | None:
    """Fetch a book thumbnail from the Google Books API (no key required)."""
    try:
        import urllib.request, urllib.parse
        q   = urllib.parse.quote(f"intitle:{title} inauthor:{author}")
        url = f"https://www.googleapis.com/books/v1/volumes?q={q}&maxResults=1"
        with urllib.request.urlopen(url, timeout=6) as r:
            data = json.loads(r.read())
        items = data.get("items", [])
        if not items:
            return None
        imgs    = items[0].get("volumeInfo", {}).get("imageLinks", {})
        img_url = (imgs.get("thumbnail") or imgs.get("smallThumbnail") or "").replace("http://", "https://")
        if not img_url:
            return None
        with urllib.request.urlopen(img_url, timeout=6) as r:
            return r.read()
    except Exception:
        return None


def _fetch_embedded_cover(tmp: Path, suffix: str) -> bytes | None:
    """Extract an embedded cover image from an EPUB or render the first PDF page."""
    if suffix == ".epub":
        try:
            import ebooklib
            from ebooklib import epub as _epub
            book = _epub.read_epub(str(tmp))
            for item in book.get_items():
                if item.get_type() == ebooklib.ITEM_COVER:
                    return item.get_content()
            for item in book.get_items():
                if "cover" in item.get_name().lower() and item.get_type() == ebooklib.ITEM_IMAGE:
                    return item.get_content()
        except Exception:
            pass
    if suffix == ".pdf":
        try:
            import fitz
            doc = fitz.open(str(tmp))
            pix = doc[0].get_pixmap(matrix=fitz.Matrix(0.4, 0.4))
            return pix.tobytes("jpeg")
        except Exception:
            pass
    return None


def _cover_ext(data: bytes) -> str:
    return "png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "jpg"


def _save_cover(bid: str, data: bytes) -> None:
    (COVERS_DIR / f"{bid}.{_cover_ext(data)}").write_bytes(data)


def _section_contexts_for_book(book: dict, limit: int = 15, character: str = "", char_b: str = "") -> list[dict]:
    """Build analysis contexts directly from SQLite sections when vector retrieval is unavailable."""
    sections = get_book_sections(book["id"])
    if not sections:
        return []

    items = [(section["section_id"], section["text"], section) for section in sections]

    if character:
        needle_a = character.lower()
        needle_b = char_b.lower()
        matches = [
            item for item in items
            if needle_a in item[1].lower() and (not needle_b or needle_b in item[1].lower())
        ]
        if len(matches) < max(3, limit // 3):
            matches.extend(item for item in items if needle_a in item[1].lower() and item not in matches)
        if matches:
            items = matches
    elif len(items) > limit:
        # Sample the full arc instead of only the opening chapters.
        step = (len(items) - 1) / max(limit - 1, 1)
        indexes = sorted({round(i * step) for i in range(limit)})
        items = [items[i] for i in indexes]

    contexts = []
    for sid, text, section in items[:limit]:
        chapter_num = int(section.get("chapter_num") or 0)
        contexts.append({
            "section_id": sid,
            "section_text": text,
            "chapter_title": section.get("chapter_title") or f"Chapter {chapter_num + 1}",
            "chapter_num": chapter_num,
            "book_title": book["title"],
            "author": book["author"],
            "page_start": section.get("page_start") or 0,
            "score": 0.0,
        })
    return contexts


# ── Startup ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_dirs()
    init_db()
    migrate_json_files()
    MAPS_DIR.mkdir(exist_ok=True)
    COVERS_DIR.mkdir(exist_ok=True)
    PROFILES_DIR.mkdir(exist_ok=True)
    SUMMARIES_DIR.mkdir(exist_ok=True)
    print("Loading models…", flush=True)
    _g["embed"]  = SentenceTransformer(EMBED_MODEL)
    _g["rerank"] = CrossEncoder(RERANK_MODEL)
    vector_size = _g["embed"].get_sentence_embedding_dimension() or 1024
    _g["coll"] = get_vector_collection(vector_size=vector_size)
    print(f"Vector store: {_g['coll'].name}", flush=True)
    _g["llm"] = LLM()
    ok, err = _g["llm"].verify()
    if not ok:
        print(f"Warning: {err}", flush=True)
    info = _g["llm"].info()
    print(f"Provider: {info['provider']} · {info['answer_model']}", flush=True)
    # Warmup: force model JIT init so first real request has no extra latency
    _g["embed"].encode(["warmup"], normalize_embeddings=True, show_progress_bar=False)
    _g["rerank"].predict([["warmup", "warmup"]])
    _load_books()  # pre-warm books cache
    print("Ready →  http://127.0.0.1:8000", flush=True)
    yield


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")


# ── Mermaid helpers ───────────────────────────────────────────────────────────

def _mid(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", (s or "node").strip()) or "node"


def _ms(s: str) -> str:
    return (s or "").replace('"', "'").replace("\n", " ")


def to_mermaid(data: dict) -> str:
    lines = [
        "graph LR",
        "    classDef protagonist fill:#7c3aed,stroke:#5b21b6,color:#fff,font-weight:bold",
        "    classDef antagonist  fill:#dc2626,stroke:#991b1b,color:#fff,font-weight:bold",
        "    classDef supporting  fill:#0891b2,stroke:#0e7490,color:#fff",
        "    classDef minor       fill:#1e293b,stroke:#334155,color:#94a3b8",
    ]
    valid_ids = {_mid(c["id"]) for c in data.get("characters", [])}

    for char in data.get("characters", []):
        cid  = _mid(char["id"])
        name = _ms(char.get("name", cid))
        role = char.get("role", "supporting")
        if role not in ("protagonist", "antagonist", "supporting", "minor"):
            role = "supporting"
        lines.append(f'    {cid}["{name}"]')
        lines.append(f"    class {cid} {role}")

    for rel in data.get("relationships", []):
        frm  = _mid(rel.get("from", ""))
        to   = _mid(rel.get("to", ""))
        if frm not in valid_ids or to not in valid_ids or frm == to:
            continue
        label = _ms(rel.get("label", ""))[:30]
        rtype = rel.get("type", "neutral")
        arrow = '-. "{}" .->'.format(label) if rtype in ("enemy", "rival") else '-- "{}" -->'.format(label)
        lines.append(f"    {frm} {arrow} {to}")

    return "\n".join(lines)


def extract_json(text: str) -> dict:
    from json_repair import repair_json

    original = text.strip()

    # Strip markdown code fences
    for fence in ("```json", "```"):
        if fence in original:
            original = original.split(fence, 1)[1].split("```", 1)[0].strip()
            break

    s = original.find("{")
    if s >= 0:
        e = original.rfind("}") + 1
        # If closing brace found after opening brace, use that slice.
        # If not (truncated response), take from opening brace to end of string
        # so json_repair can close the open structures.
        candidate = original[s:e] if e > s else original[s:]
    else:
        candidate = original

    # 1. Strict parse of the extracted candidate
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass

    # 2. Repair the candidate (handles missing commas, truncated arrays, etc.)
    result = repair_json(candidate, return_objects=True)
    if isinstance(result, dict) and result:
        return result

    # 3. Repair the full original text in case our slicing was wrong
    result = repair_json(original, return_objects=True)
    if isinstance(result, dict) and result:
        return result

    raise ValueError(f"Model did not return JSON. First 300 chars: {original[:300]!r}")


def _extract_char_list(text: str) -> list[dict]:
    """Parse a JSON array of {id, name} character stubs from pass-1 LLM output."""
    from json_repair import repair_json

    original = text.strip()
    for fence in ("```json", "```"):
        if fence in original:
            original = original.split(fence, 1)[1].split("```", 1)[0].strip()
            break

    s = original.find("[")
    if s >= 0:
        e = original.rfind("]") + 1
        candidate = original[s:e] if e > s else original[s:]
    else:
        candidate = original

    for attempt in (candidate, original):
        try:
            result = json.loads(attempt)
            if isinstance(result, list):
                return [c for c in result if isinstance(c, dict) and c.get("name")]
        except json.JSONDecodeError:
            pass
        result = repair_json(attempt, return_objects=True)
        if isinstance(result, list):
            return [c for c in result if isinstance(c, dict) and c.get("name")]
    return []


def _canonical_name(name: str) -> str:
    cleaned = re.sub(r"\s+", " ", (name or "").strip())
    return cleaned


def _character_id(name: str) -> str:
    folded = unicodedata.normalize("NFKD", _canonical_name(name)).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-z0-9]+", "_", folded.lower()).strip("_")
    if base:
        return base[:48]
    return hashlib.md5(name.encode()).hexdigest()[:12]


def _role_rank(role: str) -> int:
    return {"protagonist": 4, "antagonist": 3, "supporting": 2, "minor": 1}.get(role, 0)


def _relationship_rank(rtype: str) -> int:
    return {
        "romantic": 7,
        "family": 6,
        "enemy": 5,
        "rival": 4,
        "mentor": 3,
        "ally": 2,
        "neutral": 1,
    }.get(rtype, 0)


def _relationship_key(a: str, b: str) -> tuple[str, str]:
    return tuple(sorted((_character_id(a), _character_id(b))))


def _event_key(event: dict) -> str:
    title = re.sub(r"\s+", " ", str(event.get("title", "")).strip().lower())
    return f"{title}:{event.get('type', 'other')}"


def _merge_section_graphs(graphs: list[dict]) -> dict:
    characters: dict[str, dict] = {}
    name_to_id: dict[str, str] = {}
    relationships: dict[tuple[str, str], dict] = {}
    events: dict[str, dict] = {}

    for graph in graphs:
        source = graph.get("_source", {})
        for char in graph.get("characters", []) or []:
            name = _canonical_name(str(char.get("name", "")))
            if not name:
                continue
            cid = _character_id(name)
            aliases = {_canonical_name(alias) for alias in char.get("aliases", []) or [] if _canonical_name(str(alias))}
            aliases.add(name)
            name_to_id[name.lower()] = cid
            for alias in aliases:
                name_to_id[alias.lower()] = cid
            existing = characters.get(cid)
            role = char.get("role", "minor")
            if role not in ("protagonist", "antagonist", "supporting", "minor"):
                role = "minor"
            description = str(char.get("description", "")).strip()
            if not existing:
                characters[cid] = {
                    "id": cid,
                    "name": name,
                    "role": role,
                    "description": description[:160],
                    "aliases": sorted(aliases - {name}),
                    "_mentions": 1,
                }
            else:
                existing["_mentions"] += 1
                if _role_rank(role) > _role_rank(existing.get("role", "")):
                    existing["role"] = role
                if description and len(description) > len(existing.get("description", "")):
                    existing["description"] = description[:160]
                existing["aliases"] = sorted(set(existing.get("aliases", [])) | (aliases - {existing["name"]}))

        for rel in graph.get("relationships", []) or []:
            from_name = _canonical_name(str(rel.get("from", "")))
            to_name = _canonical_name(str(rel.get("to", "")))
            if not from_name or not to_name or from_name.lower() == to_name.lower():
                continue
            from_id = name_to_id.get(from_name.lower()) or _character_id(from_name)
            to_id = name_to_id.get(to_name.lower()) or _character_id(to_name)
            if from_id == to_id:
                continue
            if from_id not in characters:
                characters[from_id] = {"id": from_id, "name": from_name, "role": "minor", "description": "", "_mentions": 0, "aliases": []}
            if to_id not in characters:
                characters[to_id] = {"id": to_id, "name": to_name, "role": "minor", "description": "", "_mentions": 0, "aliases": []}
            key = tuple(sorted((from_id, to_id)))
            rtype = rel.get("type", "neutral")
            if rtype not in ("family", "ally", "enemy", "romantic", "mentor", "rival", "neutral"):
                rtype = "neutral"
            label = str(rel.get("label", rtype)).strip()[:40] or rtype
            evidence_text = str(rel.get("evidence", "")).strip()
            evidence = {
                "chapter_num": source.get("chapter_num", 0),
                "chapter_title": source.get("chapter_title", ""),
                "section_id": source.get("section_id", ""),
                "summary": evidence_text[:180],
            }
            existing = relationships.get(key)
            if not existing:
                relationships[key] = {
                    "from": from_id,
                    "to": to_id,
                    "type": rtype,
                    "label": label,
                    "strength": 1,
                    "evidence": [evidence],
                }
            else:
                existing["strength"] += 1
                if _relationship_rank(rtype) > _relationship_rank(existing.get("type", "")):
                    existing["type"] = rtype
                    existing["label"] = label
                elif label and label.lower() not in existing.get("label", "").lower() and len(existing.get("label", "")) < 30:
                    existing["label"] = label
                seen_sections = {item.get("section_id") for item in existing.get("evidence", [])}
                if evidence["section_id"] not in seen_sections:
                    existing["evidence"].append(evidence)

        for event in graph.get("events", []) or []:
            key = _event_key(event)
            if not key or key == ":other":
                continue
            if key in events:
                continue
            names = [_canonical_name(str(name)) for name in event.get("characters", []) or []]
            events[key] = {
                "title": str(event.get("title", "Evento")).strip()[:80],
                "description": str(event.get("description", "")).strip()[:220],
                "type": event.get("type", "other"),
                "characters": [name_to_id.get(name.lower()) or _character_id(name) for name in names if name],
                "is_climax": bool(event.get("is_climax", False)),
                "is_resolution": bool(event.get("is_resolution", False)),
                "is_epilogue": bool(event.get("is_epilogue", False)),
                "chapter_num": source.get("chapter_num", 0),
            }

    rels = sorted(
        relationships.values(),
        key=lambda rel: (_relationship_rank(rel.get("type", "")), rel.get("strength", 0)),
        reverse=True,
    )
    chars = sorted(characters.values(), key=lambda c: (_role_rank(c.get("role", "")), c.get("_mentions", 0), c.get("name", "")), reverse=True)
    for char in chars:
        char.pop("_mentions", None)
        if not char.get("aliases"):
            char.pop("aliases", None)
    for rel in rels:
        rel["evidence"] = rel.get("evidence", [])[:4]
    return {
        "characters": chars[:40],
        "relationships": rels[:120],
        "events": sorted(events.values(), key=lambda e: e.get("chapter_num", 0))[:30],
    }


def _contexts_for_section_graph(contexts: list[dict], limit: int = 18) -> list[dict]:
    if len(contexts) <= limit:
        return contexts
    by_chapter: dict[int, dict] = {}
    for ctx in sorted(contexts, key=lambda c: c.get("score", 0), reverse=True):
        chapter = int(ctx.get("chapter_num", 0))
        if chapter not in by_chapter:
            by_chapter[chapter] = ctx
    selected = list(by_chapter.values())
    if len(selected) < limit:
        seen = {ctx["section_id"] for ctx in selected}
        for ctx in sorted(contexts, key=lambda c: c.get("score", 0), reverse=True):
            if ctx["section_id"] not in seen:
                selected.append(ctx)
                seen.add(ctx["section_id"])
            if len(selected) >= limit:
                break
    return sorted(selected[:limit], key=lambda c: (c.get("chapter_num", 0), c.get("section_id", "")))


async def _extract_section_graphs(contexts: list[dict], llm: LLM, lang_name: str) -> list[dict]:
    graphs = []
    system = "You are a precise literary data extraction tool. Output ONLY valid JSON."
    for idx, ctx in enumerate(_contexts_for_section_graph(contexts), 1):
        content = (
            f"Book: {ctx.get('book_title')}\n"
            f"Chapter {ctx.get('chapter_num', 0) + 1}: {ctx.get('chapter_title')}\n"
            f"Section ID: {ctx.get('section_id')}\n\n"
            f"{ctx.get('section_text', '')[:7000]}\n\n---\n\n"
            f"{_SECTION_GRAPH_PROMPT}\nRespond entirely in {lang_name}."
        )
        raw = await llm.chat(
            messages=[{"role": "user", "content": content}],
            system=system,
            max_tokens=1800,
        )
        graph = extract_json(raw)
        graph["_source"] = {
            "section_id": ctx.get("section_id"),
            "chapter_num": ctx.get("chapter_num", 0),
            "chapter_title": ctx.get("chapter_title", ""),
        }
        graphs.append(graph)
    return graphs


# ── Background ingest task ────────────────────────────────────────────────────

async def _run_ingest(job_id: str, tmp: Path, title: str, author: str, language: str = ""):
    q = _jobs[job_id]
    try:
        await q.put(sse({"stage": "parsing", "msg": f"Analizando {tmp.suffix.upper()}..."}))

        def parse():
            return parse_pdf(tmp) if tmp.suffix.lower() == ".pdf" else parse_epub(tmp)

        t, a, chapters = await asyncio.to_thread(parse)
        title    = title  or t
        author   = author or a
        bid      = make_book_id(title, author)
        language = language or await asyncio.to_thread(detect_language, chapters)

        # Cover: try embedded (EPUB/PDF first page), then Google Books
        if not any((COVERS_DIR / f"{bid}.{e}").exists() for e in ("jpg", "png")):
            cover = await asyncio.to_thread(_fetch_embedded_cover, tmp, tmp.suffix.lower())
            if not cover:
                cover = await asyncio.to_thread(_fetch_google_cover, title, author)
            if cover:
                _save_cover(bid, cover)

        await q.put(sse({"stage": "chunking",
                          "msg": f"Se encontraron {len(chapters)} capítulos. Dividiendo el texto..."}))

        ids, texts, metas, sections_store = [], [], [], {}
        for ch_idx, ch in enumerate(chapters):
            for si, sec in enumerate(split_sections(ch["text"])):
                sec_id = f"{bid}:ch{ch_idx}:s{si}"
                sections_store[sec_id] = sec
                for pi, passage in enumerate(split_passages(sec)):
                    ids.append(f"{sec_id}:p{pi}")
                    texts.append(passage)
                    metas.append({
                        "book_id":       bid,
                        "book_title":    title,
                        "author":        author,
                        "chapter_num":   ch_idx,
                        "chapter_title": ch["title"],
                        "section_id":    sec_id,
                        "page_start":    ch.get("page_start") or 0,
                        "language":      language,
                    })

        if not ids:
            raise ValueError(
                "No se encontraron pasajes legibles en este archivo. "
                "Revisa que el PDF/EPUB contenga texto seleccionable e inténtalo de nuevo."
            )

        await q.put(sse({"stage": "embedding",
                          "msg": f"Vectorizando {len(texts)} pasajes...",
                          "total": len(texts)}))

        embeddings = await asyncio.to_thread(
            _g["embed"].encode, [PASSAGE_PREFIX + t for t in texts],
            **{"batch_size": 32, "show_progress_bar": False, "normalize_embeddings": True},
        )
        embeddings = embeddings.tolist()

        await q.put(sse({"stage": "storing", "msg": "Guardando en la base vectorial..."}))

        coll = _g["coll"]
        existing: set[str] = set()
        for i in range(0, len(ids), 500):
            existing.update(coll.get(ids=ids[i : i + 500])["ids"])

        new = [i for i, pid in enumerate(ids) if pid not in existing]
        for i in range(0, len(new), 500):
            batch = new[i : i + 500]
            coll.add(
                ids        = [ids[j]        for j in batch],
                embeddings = [embeddings[j] for j in batch],
                documents  = [texts[j]      for j in batch],
                metadatas  = [metas[j]      for j in batch],
            )

        sf = SECTIONS_DIR / f"{bid}.json"
        prev = json.loads(sf.read_text()) if sf.exists() else {}
        prev.update(sections_store)
        sf.write_text(json.dumps(prev, ensure_ascii=False, indent=2))

        books = [b for b in _load_books() if b["id"] != bid]
        book_record = {"id": bid, "title": title, "author": author,
                       "language": language,
                       "chapters": len(chapters), "passages": len(ids)}
        upsert_book(book_record)
        upsert_sections(bid, prev, metas)
        books.append(book_record)
        _save_books(books)

        await q.put(sse({"done": True, "msg": "Listo",
                          "book": {"id": bid, "title": title, "author": author,
                                   "language": language,
                                   "chapters": len(chapters), "passages": len(ids)}}))
    except Exception as exc:
        await q.put(sse({"error": str(exc)}))
    finally:
        tmp.unlink(missing_ok=True)
        await asyncio.sleep(300)
        _jobs.pop(job_id, None)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root():
    react_index = FRONTEND_DIST / "index.html"
    if react_index.exists():
        return react_index.read_text()
    return (BASE_DIR / "templates" / "index.html").read_text()


@app.get("/api/books")
async def api_books():
    books = _load_books()
    for b in books:
        bid = b["id"]
        b["has_cover"] = any((COVERS_DIR / f"{bid}.{e}").exists() for e in ("jpg", "png"))
        b["has_map"] = has_analysis_cache(bid, "character_map") or (MAPS_DIR / f"{bid}.json").exists()
        b["profiles"] = list_profile_caches(bid)
    return books


@app.get("/api/books/{book_id}/cover")
async def api_book_cover(book_id: str):
    for ext in ("jpg", "png"):
        f = COVERS_DIR / f"{book_id}.{ext}"
        if f.exists():
            return Response(f.read_bytes(), media_type="image/jpeg" if ext == "jpg" else "image/png")
    # On-demand fetch for books ingested before covers were added
    book = get_book(book_id)
    if book:
        data = await asyncio.to_thread(_fetch_google_cover, book["title"], book["author"])
        if data:
            _save_cover(book_id, data)
            return Response(data, media_type="image/png" if _cover_ext(data) == "png" else "image/jpeg")
    raise HTTPException(status_code=404, detail="No hay portada")


@app.delete("/api/books/{book_id}")
async def api_delete_book(book_id: str):
    coll = _g["coll"]
    res  = coll.get(where={"book_id": book_id})
    if res["ids"]:
        coll.delete(ids=res["ids"])
    (SECTIONS_DIR / f"{book_id}.json").unlink(missing_ok=True)
    (MAPS_DIR     / f"{book_id}.json").unlink(missing_ok=True)
    for ext in ("jpg", "png"):
        (COVERS_DIR / f"{book_id}.{ext}").unlink(missing_ok=True)
    prof_dir = PROFILES_DIR / book_id
    if prof_dir.exists():
        shutil.rmtree(prof_dir)
    sum_dir = SUMMARIES_DIR / book_id
    if sum_dir.exists():
        shutil.rmtree(sum_dir)
    delete_book_record(book_id)
    if BOOKS_FILE.exists():
        BOOKS_FILE.write_text(json.dumps([b for b in _load_books() if b["id"] != book_id], indent=2))
    return {"ok": True}


@app.get("/api/search")
async def api_search(q: str, book_id: str = "", top_k: int = 10):
    if not q.strip():
        return {"results": []}
    embed = _g["embed"]
    coll  = _g["coll"]
    top_k = max(1, min(top_k, 30))

    q_vec = await asyncio.to_thread(
        lambda: embed.encode(
            [f"query: {q}"], normalize_embeddings=True, show_progress_bar=False
        ).tolist()[0]
    )

    where = {"book_id": book_id} if book_id else None
    raw   = coll.query(
        query_embeddings=[q_vec],
        n_results=top_k,
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    results = []
    for text, meta, dist in zip(
        raw["documents"][0], raw["metadatas"][0], raw["distances"][0]
    ):
        results.append({
            "text":          text,
            "book_title":    meta.get("book_title", ""),
            "book_id":       meta.get("book_id", ""),
            "chapter_num":   meta.get("chapter_num", 0),
            "chapter_title": meta.get("chapter_title", ""),
            "score":         round(max(0.0, 1.0 - dist / 2), 3),
        })

    return {"results": results}


@app.get("/api/config")
async def api_get_config():
    llm  = _g["llm"]
    cfg  = load_config()
    info = llm.info()
    pcfg = cfg.get(info["provider"], {})
    return {
        "provider":      info["provider"],
        "answer_model":  info["answer_model"],
        "expand_model":  info["expand_model"],
        "context_limit": info["context_limit"],
        "base_url":      pcfg.get("base_url", ""),
        "has_key":       bool(pcfg.get("api_key", "")),
    }


@app.post("/api/config")
async def api_save_config(req: Request):
    data = await req.json()
    try:
        save_config(data)
        _g["llm"] = LLM()   # reload with new settings
        ok, err = _g["llm"].verify()
        info = _g["llm"].info()
        return {"ok": True, "provider": info["provider"],
                "answer_model": info["answer_model"], "warning": err or None}
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)


@app.post("/api/config/models")
async def api_list_models(req: Request):
    data = await req.json()
    provider = data.get("provider") or _g["llm"].provider
    try:
        models = list_available_models(provider, data)
        return {"provider": provider, "models": models}
    except Exception as exc:
        return JSONResponse({"models": [], "error": str(exc)}, status_code=400)


async def _save_upload_to_temp(file: UploadFile, suffix: str) -> Path:
    """Stream an uploaded book to a secure temp file while enforcing a size cap."""
    total = 0
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = Path(tmp.name)
            while True:
                chunk = await file.read(UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"El archivo es demasiado grande. El tamaño máximo es {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
                    )
                tmp.write(chunk)
        return tmp_path
    except Exception:
        if tmp_path:
            tmp_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@app.post("/api/ingest")
async def api_ingest(
    file:     UploadFile = File(...),
    title:    str = Form(""),
    author:   str = Form(""),
    language: str = Form(""),
):
    suffix = Path(file.filename or "book.pdf").suffix.lower()
    if suffix not in (".pdf", ".epub"):
        return JSONResponse({"error": "Solo se aceptan archivos .pdf y .epub"}, status_code=400)

    tmp = await _save_upload_to_temp(file, suffix)

    job_id = uuid4().hex[:8]
    _jobs[job_id] = asyncio.Queue()
    asyncio.create_task(_run_ingest(job_id, tmp, title.strip(), author.strip(), language.strip()))
    return {"job_id": job_id}


@app.get("/api/ingest/{job_id}")
async def api_ingest_stream(job_id: str):
    q = _jobs.get(job_id)
    if not q:
        return JSONResponse({"error": "Tarea no encontrada"}, status_code=404)

    async def stream():
        while True:
            msg  = await q.get()
            yield msg
            data = json.loads(msg[5:])
            if data.get("done") or data.get("error"):
                break

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@app.post("/api/query/stream")
async def api_query(req: Request):
    body       = await req.json()
    question   = body.get("question", "").strip()
    book_title = body.get("book_title", "").strip() or None
    top_k      = max(1, min(int(body.get("top_k", 5)), 12))
    llm        = _g["llm"]

    async def stream():
        if not question:
            yield sse({"error": "La pregunta está vacía"}); return

        yield sse({"stage": "expanding", "msg": "Expandiendo la consulta..."})
        queries = await asyncio.to_thread(expand_queries, question, llm)

        yield sse({"stage": "searching", "msg": f"Buscando {len(queries)} variantes de consulta..."})
        contexts = await asyncio.to_thread(
            retrieve, queries, _g["embed"], _g["rerank"], _g["coll"], book_title, top_k
        )

        if not contexts:
            yield sse({"error": "No se encontraron pasajes relevantes."}); return

        contexts, dropped = fit_contexts(contexts, llm.context_limit,
                                          system=SYSTEM_PROMPT, question=question)
        status_msg = f"Se encontraron {len(contexts)} secciones. Generando respuesta..."
        if dropped:
            status_msg += f" ({dropped} se descartaron para caber en la ventana de {llm.context_limit} tokens)"
        yield sse({"stage": "answering", "msg": status_msg})
        yield sse({"stage": "waiting", "msg": f"Esperando respuesta de {llm.provider}..."})

        ctx_text = build_context_block(contexts)
        async for chunk in llm.stream(
            messages=[{"role": "user",
                        "content": f"Pasajes:\n\n{ctx_text}\n\n---\n\nPregunta: {question}"}],
            system=SYSTEM_PROMPT,
            max_tokens=2048,
        ):
            yield sse({"type": "text", "text": chunk})

        sources = [{"book": c["book_title"],
                     "chapter": f"Cap. {c['chapter_num']+1}: {c['chapter_title']}"}
                    for c in contexts]
        yield sse({"done": True, "sources": sources})

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@app.get("/api/tasks/character-map/{book_id}")
async def api_char_map(book_id: str, regen: bool = False):
    llm = _g["llm"]

    async def stream():
        cache_file = MAPS_DIR / f"{book_id}.json"
        if not regen:
            cached = get_analysis_cache(book_id, "character_map")
            if not cached and cache_file.exists():
                try:
                    cached = json.loads(cache_file.read_text())
                    set_analysis_cache(book_id, "character_map", cached)
                except Exception:
                    cached = None
            if cached:
                yield sse({"done": True, "mermaid": to_mermaid(cached), "data": cached, "cached": True})
                return

        books = _load_books()
        book  = next((b for b in books if b["id"] == book_id), None)
        if not book:
            yield sse({"error": "Libro no encontrado"}); return
        if not book.get("passages"):
            yield sse({"error": "Este libro no tiene pasajes indexados. Vuelve a ingerirlo antes de analizarlo."}); return

        lang      = book.get("language", "en")
        lang_name = {"en": "English", "es": "Spanish", "fr": "French"}.get(lang, "English")
        lang_note = f"\nAll character names, descriptions and labels must be in {lang_name}."

        # ── Pass 1: broad retrieval to discover character names ───────────────
        yield sse({"stage": "searching", "msg": "Retrieving character passages…"})

        char_queries = [
            "main character protagonist hero central figure",
            "antagonist villain enemy rival opponent",
            "secondary characters allies companions supporters",
            "family relationships father mother brother sister",
            "mentor teacher guide student apprentice",
            "romance love relationship partner spouse",
            "betrayal deception conflict confrontation power struggle",
            "new character introduced appearance first encounter",
            "political authority leader ruler command hierarchy",
            "death sacrifice loss grief loyalty tested",
        ]
        p1_contexts = await asyncio.to_thread(
            retrieve, char_queries, _g["embed"], _g["rerank"],
            _g["coll"], None, 15, book_id,
        )
        if not p1_contexts:
            p1_contexts = await asyncio.to_thread(_section_contexts_for_book, book, 15)
        if not p1_contexts:
            yield sse({"error": "No se encontraron pasajes para este libro. Vuelve a ingerirlo para reconstruir sus secciones."}); return

        yield sse({"stage": "discovering", "msg": "Identificando personajes..."})

        p1_fit, _ = fit_contexts(p1_contexts, llm.context_limit,
                                 system="You are a data extraction tool.",
                                 question=_DISCOVER_PROMPT, reserve_output=600)
        p1_ctx_text = build_context_block(p1_fit)

        char_list: list[dict] = []
        try:
            raw_names = await llm.chat(
                messages=[{"role": "user",
                           "content": f"Passages:\n\n{p1_ctx_text}\n\n---\n\n{_DISCOVER_PROMPT}"}],
                system="You are a data extraction tool. Output ONLY valid JSON. No preamble, no explanation, no markdown.",
                max_tokens=600,
            )
            char_list = _extract_char_list(raw_names)
        except Exception:
            pass  # fall back to single-pass if discovery fails

        # ── Pass 2: targeted retrieval per character ──────────────────────────
        if char_list:
            yield sse({"stage": "expanding",
                       "msg": f"Ampliando contexto para {len(char_list)} personajes..."})

            char_queries_p2 = []
            for c in char_list:
                name = c["name"]
                char_queries_p2.append(f"{name} character description role relationships")
                char_queries_p2.append(f"{name} speaks meets confronts interacts with")
            p2_contexts = await asyncio.to_thread(
                retrieve, char_queries_p2, _g["embed"], _g["rerank"],
                _g["coll"], None, 15, book_id,
            )
            if not p2_contexts:
                p2_contexts = await asyncio.to_thread(_section_contexts_for_book, book, 15)

            # Merge p1 + p2, deduplicate by section_id, keep highest score
            merged: dict[str, dict] = {}
            for ctx in p1_contexts + (p2_contexts or []):
                sid = ctx.get("section_id") or ctx.get("id", "")
                if sid not in merged or ctx["score"] > merged[sid]["score"]:
                    merged[sid] = ctx
            contexts = sorted(merged.values(), key=lambda x: x["score"], reverse=True)
        else:
            contexts = p1_contexts

        # ── Section-level extraction + deterministic merge ───────────────────
        out_tokens = min(4000, max(2000, int(llm.context_limit * 0.4))) \
                     if llm.context_limit else 4000

        graph_contexts = contexts
        contexts, dropped = fit_contexts(contexts, llm.context_limit,
                                         question=_MAP_PROMPT, reserve_output=out_tokens)
        msg = f"Analizando {len(contexts)} secciones..."
        if dropped:
            msg += f" ({dropped} fuera de la ventana de contexto)"
        yield sse({"stage": "analyzing", "msg": msg})

        try:
            yield sse({"stage": "analyzing", "msg": "Extrayendo relaciones por sección..."})
            section_graphs = await _extract_section_graphs(graph_contexts, llm, lang_name)
            data = _merge_section_graphs(section_graphs)
            if len(data.get("characters", [])) >= 2 and data.get("relationships"):
                set_analysis_cache(book_id, "character_map", data)
                yield sse({"done": True, "mermaid": to_mermaid(data), "data": data})
                return
        except Exception:
            # Fall back to the previous single merged-context extraction.
            pass

        ctx_text = build_context_block(contexts)
        raw = await llm.chat(
            messages=[{"role": "user",
                       "content": f"Book passages:\n\n{ctx_text}\n\n---\n\n{_MAP_PROMPT}{lang_note}"}],
            system="You are a data extraction tool. Output ONLY valid JSON. No preamble, no explanation, no markdown.",
            max_tokens=out_tokens,
        )

        try:
            data = extract_json(raw)
            set_analysis_cache(book_id, "character_map", data)
            yield sse({"done": True, "mermaid": to_mermaid(data), "data": data})
        except Exception as exc:
            yield sse({"error": f"No se pudieron interpretar los datos de personajes: {exc}", "raw": raw})

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@app.get("/api/tasks/character-chart/{book_id}")
async def api_char_chart(book_id: str, character: str, regen: bool = False):
    llm = _g["llm"]

    async def stream():
        if not character.strip():
            yield sse({"error": "Se requiere el nombre del personaje"}); return

        # Serve from cache unless regenerating
        prof_dir   = PROFILES_DIR / book_id
        cache_file = prof_dir / f"{_safe_name(character)}.json"
        profile_key = _safe_name(character)
        if not regen:
            cached = get_analysis_cache(book_id, "character_profile", profile_key)
            if not cached and cache_file.exists():
                try:
                    cached = json.loads(cache_file.read_text())
                    set_analysis_cache(book_id, "character_profile", cached, profile_key)
                except Exception:
                    cached = None
            if cached:
                yield sse({"type": "text", "text": cached["content"], "cached": True})
                yield sse({"done": True, "sources": [], "cached": True})
                return

        books = _load_books()
        book  = next((b for b in books if b["id"] == book_id), None)
        if not book:
            yield sse({"error": "Libro no encontrado"}); return
        if not book.get("passages"):
            yield sse({"error": "Este libro no tiene pasajes indexados. Vuelve a ingerirlo antes de generar perfiles."}); return

        yield sse({"stage": "searching", "msg": f"Finding passages about {character}…"})

        char_queries = [
            character,
            f"{character} personality traits motivation",
            f"{character} background history",
            f"{character} relationships interactions",
            f"{character} key scenes decisions",
        ]
        contexts = await asyncio.to_thread(
            retrieve, char_queries, _g["embed"], _g["rerank"],
            _g["coll"], None, 10, book_id,
        )
        if not contexts:
            contexts = await asyncio.to_thread(_section_contexts_for_book, book, 10, character)
        if not contexts:
            yield sse({"error": f"No se encontraron pasajes sobre '{character}'."}); return

        prompt = _CHART_PROMPT.format(name=character)
        contexts, dropped = fit_contexts(contexts, llm.context_limit,
                                          question=prompt, reserve_output=3000)
        msg = f"Construyendo perfil de {character}..."
        if dropped:
            msg += f" ({dropped} secciones descartadas por la ventana de contexto)"
        yield sse({"stage": "analyzing", "msg": msg})

        ctx_text  = build_context_block(contexts)
        lang      = book.get("language", "en")
        lang_name = {"en": "English", "es": "Spanish", "fr": "French"}.get(lang, "English")

        yield sse({"stage": "waiting", "msg": f"Esperando respuesta de {llm.provider}..."})
        chunks = []
        async for chunk in llm.stream(
            messages=[{"role": "user",
                        "content": f"Passages:\n\n{ctx_text}\n\n---\n\n{prompt}"}],
            system=f"You are a literary analyst. Create detailed, well-structured character profiles. Respond entirely in {lang_name}.",
            max_tokens=3000,
        ):
            chunks.append(chunk)
            yield sse({"type": "text", "text": chunk})

        set_analysis_cache(
            book_id,
            "character_profile",
            {"name": character, "content": "".join(chunks)},
            profile_key,
        )

        sources = [{"book": c["book_title"],
                     "chapter": f"Ch.{c['chapter_num']+1}: {c['chapter_title']}"}
                    for c in contexts]
        yield sse({"done": True, "sources": sources})

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@app.get("/api/tasks/relationship/{book_id}")
async def api_relationship(book_id: str, char_a: str, char_b: str):
    llm = _g["llm"]

    async def stream():
        books = _load_books()
        book  = next((b for b in books if b["id"] == book_id), None)
        if not book:
            yield sse({"error": "Libro no encontrado"}); return
        if not book.get("passages"):
            yield sse({"error": "Este libro no tiene pasajes indexados. Vuelve a ingerirlo antes de analizar relaciones."}); return

        yield sse({"stage": "searching", "msg": f"Finding scenes with {char_a} and {char_b}…"})

        queries = [
            f"{char_a} {char_b}",
            f"{char_a} and {char_b} interaction scene",
            f"{char_a} {char_b} conflict tension confrontation",
            f"{char_a} speaks meets {char_b}",
            f"{char_a} character role relationship",
            f"{char_b} character role relationship",
        ]
        contexts = await asyncio.to_thread(
            retrieve, queries, _g["embed"], _g["rerank"],
            _g["coll"], None, 5, book_id,
        )
        if not contexts:
            contexts = await asyncio.to_thread(_section_contexts_for_book, book, 5, char_a, char_b)
        if not contexts:
            yield sse({"error": "No se encontraron pasajes para esta relación."}); return

        prompt    = _RELATION_PROMPT.format(name_a=char_a, name_b=char_b)
        contexts, _ = fit_contexts(contexts, llm.context_limit,
                                   question=prompt, reserve_output=1200)
        yield sse({"stage": "analyzing", "msg": "Analizando relación..."})

        ctx_text  = build_context_block(contexts)
        lang      = book.get("language", "en")
        lang_name = {"en": "English", "es": "Spanish", "fr": "French"}.get(lang, "English")

        yield sse({"stage": "waiting", "msg": f"Esperando respuesta de {llm.provider}..."})
        async for chunk in llm.stream(
            messages=[{"role": "user",
                       "content": f"Passages:\n\n{ctx_text}\n\n---\n\n{prompt}"}],
            system=f"You are a literary analyst. Create concise, focused relationship analyses. Respond entirely in {lang_name}.",
            max_tokens=1200,
        ):
            yield sse({"type": "text", "text": chunk})

        yield sse({"done": True})

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)


@app.get("/api/books/{book_id}/chapters")
async def api_book_chapters(book_id: str):
    chapters = get_chapters(book_id)
    for ch in chapters:
        ch["cached"] = has_analysis_cache(book_id, "chapter_summary", f"ch{ch['num']}")
    return chapters


@app.get("/api/tasks/chapter-summary/{book_id}")
async def api_chapter_summary(book_id: str, chapter_num: int, regen: bool = False):
    llm = _g["llm"]

    async def stream():
        books = _load_books()
        book  = next((b for b in books if b["id"] == book_id), None)
        if not book:
            yield sse({"error": "Libro no encontrado"}); return

        cache_subject = f"ch{chapter_num}"

        if not regen:
            cached = get_analysis_cache(book_id, "chapter_summary", cache_subject)
            cache_file = SUMMARIES_DIR / book_id / f"ch{chapter_num}.json"
            if not cached and cache_file.exists():
                try:
                    cached = json.loads(cache_file.read_text())
                    set_analysis_cache(book_id, "chapter_summary", cached, cache_subject)
                except Exception:
                    cached = None
        else:
            cached = None
        if cached:
            yield sse({"type": "text", "text": cached["summary"], "cached": True})
            yield sse({"done": True, "cached": True})
            return

        sections = get_chapter_sections(book_id, chapter_num)

        if not sections:
            yield sse({"error": "No se encontró texto para este capítulo."}); return

        ch_title = get_chapter_title(book_id, chapter_num) or f"Chapter {chapter_num + 1}"

        yield sse({"stage": "reading", "msg": f"Reading {len(sections)} sections…"})

        ctx_text  = "\n\n---\n\n".join(sections)
        max_chars = (llm.context_limit * 4 - 6000) if llm.context_limit else 160_000
        if max_chars > 0 and len(ctx_text) > max_chars:
            ctx_text = ctx_text[:max_chars]

        prompt    = _CHAPTER_PROMPT.format(num=chapter_num + 1, title=ch_title)
        lang      = book.get("language", "en")
        lang_name = {"en": "English", "es": "Spanish", "fr": "French"}.get(lang, "English")

        yield sse({"stage": "analyzing", "msg": "Resumiendo capítulo..."})
        yield sse({"stage": "waiting", "msg": f"Esperando respuesta de {llm.provider}..."})

        accumulated = ""
        async for chunk in llm.stream(
            messages=[{"role": "user",
                       "content": f"Chapter text:\n\n{ctx_text}\n\n---\n\n{prompt}"}],
            system=f"You are a literary analyst. Write clear, insightful chapter summaries. Respond entirely in {lang_name}.",
            max_tokens=1500,
        ):
            accumulated += chunk
            yield sse({"type": "text", "text": chunk})

        if accumulated:
            set_analysis_cache(book_id, "chapter_summary", {
                "chapter_num":   chapter_num,
                "chapter_title": ch_title,
                "summary":       accumulated,
            }, cache_subject)

        yield sse({"done": True})

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)


# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
