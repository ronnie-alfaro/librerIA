# BookGraph

A local Retrieval-Augmented Generation (RAG) system for books. Ingest PDF and EPUB files, then query them in natural language, generate character maps, explore relationship deep-dives, and build deep character profiles — all running on your own machine with any LLM.

---

## Features

- **Ingest** PDF and EPUB books via drag-and-drop web UI or CLI
- **Query** your entire library or a single book with natural language questions
- **Multi-query expansion** — the LLM rewrites your question into 3 variants to improve recall
- **Cross-encoder re-ranking** — retrieved passages are re-scored against the original question for precision
- **Character Map** — Force-directed network graph (vis-network) with the protagonist pinned at the centre and all other characters arranged by the physics engine; nodes are colour-coded by role and edges by relationship type
- **Two-pass character retrieval** — pass 1 discovers all character names; pass 2 runs targeted queries per character and merges both pools for maximum coverage
- **Semantic search** — search your entire library (or a single book) with natural language; results show matched passages ranked by semantic similarity with chapter context
- **Timeline** — emoji-coded event track in narrative order; climax and resolution events are highlighted; a 🏁 FIN divider marks the story's end; epilogue events appear below; exportable as PDF
- **Relationship Deep-Dive** — click any edge in the character map to open a side panel with an LLM analysis of how two characters relate, including key shared scenes and how the relationship evolved
- **Character Profile** — deep-dive analysis of any character rendered as a styled literary card: personality, arc, relationships, key moments, and notable quotes
- **PDF exports** — Timeline, Chapter Summaries, and Character Profiles can each be exported as a dark-themed PDF via the browser print dialog (no extra libraries)
- **5-tab Book Analysis** — Character Map, Timeline, Characters, Chapters, and Profiles live in a single card; the Profiles tab shows a role-colored avatar grid with a violet dot for cached profiles
- **Chapter Summaries** — click any chapter in the Chapters tab to stream an LLM summary (Overview, Key Events, Character Moments, Themes & Tone); summaries are cached and can be regenerated
- **Book covers** — automatically extracted from EPUB metadata, rendered from the PDF first page, or fetched from the Google Books API
- **Click to analyse** — clicking any book card in the library opens Book Analysis instantly; cached maps load immediately, otherwise the Start Analysis prompt is shown
- **Library quick-links** — cached maps and profiles appear as one-click links on each book card so you never regenerate unnecessarily
- **Multilingual** — supports English, Spanish, and French; language is auto-detected on ingest and used for prompts, maps, and profiles
- **UI language toggle** — switch the interface between English and Spanish (EN/ES) with one click; preference is saved in the browser
- **LLM-agnostic** — works with Anthropic Claude, OpenAI, Google Gemini, and any local model via llama.cpp or Ollama
- **MCP server** — exposes the library as tools for Claude Desktop
- **Full caching** — character maps and character profiles are saved to disk and served instantly on repeat visits; a Re-analyze / Regenerate button forces a fresh run

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 Web UI (FastAPI)                │
│  templates/index.html  ←→  app.py              │
└───────────────────┬─────────────────────────────┘
                    │ SSE streams
        ┌───────────▼──────────────┐
        │      RAG Pipeline        │
        │                          │
        │  ingest.py  query.py     │
        │  llm.py     mcp_server.py│
        └───────────┬──────────────┘
                    │
        ┌───────────▼──────────────┐
        │        Storage           │
        │                          │
        │  Qdrant/Chroma vector store               │
        │  db/bookgraph.db SQLite app state         │
        │  db/covers/     book cover images         │
        └──────────────────────────┘
```

SQLite stores structured state (`books`, `sections`) plus flexible JSON payloads in `analysis_cache.payload` for character maps, character profiles, and chapter summaries. Legacy JSON files under `db/sections`, `db/maps`, `db/profiles`, and `db/summaries` are migrated automatically on startup and kept only as a compatibility fallback.

### Chunking strategy

Each book is split into two levels:

| Level | Size | Purpose |
|-------|------|---------|
| **Section** | ~1 500 words | What the LLM reads as context |
| **Passage** | ~300 words, 50-word overlap | What gets embedded and searched |

Passages are embedded and stored in the configured vector store. ChromaDB is the default local store; Qdrant can be enabled for remote vector storage. On retrieval, the matching passage points back to its parent section, so the LLM always gets a full, coherent chunk of text rather than a short snippet.

### Retrieval pipeline

1. The question is expanded into 3 alternative queries by a fast LLM call.
2. All queries are embedded with `intfloat/multilingual-e5-large` (prefixed `"query: "`).
3. The vector store returns up to `4 × top_k` candidate passages per query (cosine similarity).
4. Candidates are deduplicated by section (only the closest-matching passage per section is kept).
5. The cross-encoder `mmarco-mMiniLMv2-L12-H384-v1` re-scores each section against the original question.
6. The top `top_k` sections are sent to the LLM as context.

### Character map — two-pass retrieval

The character map uses a two-pass strategy to maximise character and relationship coverage:

| Pass | Queries | top_k | Purpose |
|------|---------|-------|---------|
| **Pass 1** | 10 broad character queries | 15 | Discover all named characters (fast, ~600-token LLM call) |
| **Pass 2** | Two queries per discovered character | 15 | Targeted retrieval; merged with pass-1 sections |

The merged pool is deduplicated by section ID (best score wins) and sorted before the full extraction call. If pass-1 discovery fails the system falls back to single-pass automatically.

Progress stages: `searching` → `discovering` → `expanding` → `analyzing`

### Embedding model notes

Both ingest and query use `intfloat/multilingual-e5-large`.

- Passages indexed with prefix `"passage: "` — **must** re-ingest if switching models.
- Queries encoded with prefix `"query: "`.
- If you switch embedding models, clear the vector collection and re-ingest all books.

---

## Requirements

- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (recommended) or pip
- One of: Anthropic API key · OpenAI API key · Gemini API key · local llama.cpp/Ollama server

---

## Installation

```bash
git clone <repo>
cd BookGraph
uv sync          # installs all dependencies from pyproject.toml
```

### Vector store

BookGraph uses ChromaDB locally by default. To store vectors remotely in Qdrant, create a local `.env` file:

```bash
VECTOR_STORE=qdrant
QDRANT_URL=https://your-cluster.cloud.qdrant.io
QDRANT_API_KEY=your-api-key
QDRANT_COLLECTION=passages
```

When switching from Chroma to Qdrant, re-ingest existing books so their passage embeddings are uploaded to the remote collection.

---

## Ingest books

### Web UI

1. Start the server: `uv run app.py`
2. Open `http://localhost:8000`
3. Drag a PDF or EPUB onto the upload zone (or click to browse).
4. Optionally set title, author, and language (auto-detected if left blank).
5. Watch the progress bar — parsing → chunking → embedding → storing.

A cover image is extracted automatically (EPUB metadata → PDF first page → Google Books API fallback) and shown on the book card.

### CLI

```bash
uv run ingest.py book.pdf
uv run ingest.py book.epub --title "Dune" --author "Frank Herbert"
uv run ingest.py book.pdf --language es   # skip auto-detection
```

---

## Query

### Web UI

Go to the **Query** section, type a question, and optionally filter by book. Results stream back with inline sources.

### CLI

```bash
uv run query.py "Who is connected to Paul and how?"
uv run query.py "What drives the protagonist?" --book "Dune"
uv run query.py "..." --top-k 8 --no-expand --show-sources
```

| Flag | Default | Description |
|------|---------|-------------|
| `--book` | all books | Filter retrieval to one book (exact title) |
| `--top-k` | 5 | Number of sections to retrieve |
| `--no-expand` | off | Skip multi-query expansion |
| `--show-sources` | off | Print retrieved passages before the answer |

---

## Search (web UI only)

The **Search** tab lets you find specific passages across your library using natural language — anything from a single word to a full sentence or quote fragment.

- Results are ranked by **semantic similarity** (cosine distance via the same embedding model used for retrieval)
- Each result shows the matched passage text, the book and chapter it came from, and a relevance score (0–1)
- Filter by book using the dropdown to restrict search to a single title
- Adjust the **Results** slider (1–30) to control how many matches are returned
- Click **▼ Show full passage** on any result to expand it to the full indexed passage

Search hits the same configured vector store and embedding model as the query pipeline, so it finds semantically related text even when the exact words differ.

---

## Book Analysis (web UI only)

Click any book card in the **Library** to open it directly in Book Analysis, or navigate to **Book Analysis** and use the visual book picker in the header. If a cached map exists it loads immediately; otherwise click **Start Book Analysis**.

Book Analysis is organised into five tabs:

| Tab | Contents |
|-----|----------|
| **Character Map** | Interactive force-directed network — protagonist at centre, all characters arranged by physics |
| **Timeline** | Emoji-coded events in narrative order |
| **Characters** | Full character list with role badges and Profile buttons |
| **Chapters** | Chapter list with cached-summary indicators; click any chapter to generate or view its LLM summary |
| **Profiles** | Role-colored avatar grid; click any character to open their profile |

### Character Map

Runs the two-pass retrieval strategy, then asks the LLM to return structured JSON listing every named character, their role, a one-sentence description, and all relationships (type + label).

The result is rendered as a **vis-network force-directed graph**:

- The **protagonist** is pinned at the centre of the canvas; all other characters are arranged by the forceAtlas2Based physics engine and freeze in place once stable
- **Node colour** encodes role: purple = protagonist, red = antagonist, teal = supporting, dark = minor
- **Edge colour** and style encode relationship type: family, ally, enemy, rival, romantic, mentor, neutral (dashed edges for adversarial relationships)
- **Click** a node to open the character info panel (description, connections, role badge, and key events)
- **Click** an edge to open the Relationship Deep-Dive panel for those two characters
- **Scroll** to zoom; **drag** to pan
- **⊡ Fit** re-fits the diagram to the viewport
- **↻ Re-analyze** forces a fresh LLM run and overwrites the cache

The map is cached in `db/maps/{book_id}.json` and served instantly on subsequent visits. A direct link to it appears on the book card in the library.

### Timeline

The **Timeline** tab displays all extracted events in narrative order:

- Each event has an emoji that encodes its type (⚔️ battle, 💀 death, ❤️ romance, 🗡️ betrayal, 🔍 discovery, 🤝 meeting, 🚶 journey, 🎭 ceremony, 👑 political, 🦋 transformation, 💥 conflict, 📖 other)
- Events are connected by a vertical timeline with colour-coded glowing dots
- The **climax** event is highlighted in amber; the **resolution** event is highlighted in violet
- A **🏁 FIN** divider marks the end of the main story
- If the book has an epilogue, those events appear in a separate section below FIN
- Click any character badge on an event to jump to that character's info panel
- **↓ PDF** exports the full timeline as a dark-themed PDF

### Relationship Deep-Dive

Click any edge (line) in the character map to open the relationship panel alongside the graph:

- Shows both character names and role badges at the top
- An LLM analysis streams in covering: How They Met · Dynamic & Power Balance · Key Scenes Together · How It Evolved · Tension & Current Status
- The panel closes with the × button or by clicking a different node

### Chapter Summaries

The **Chapters** tab lists all chapters detected in the book (sourced from vector metadata). Each chapter shows:

- Chapter number and title
- A violet dot if a cached summary already exists

Click any chapter to open the detail view. If no summary exists, a **Generate Summary** button appears; click it to stream an LLM-generated summary. If a cached summary exists it loads immediately. The **↻ Regenerate** button forces a fresh run and overwrites the cache.

Each summary is structured into four sections: **Overview · Key Events · Character Moments · Themes & Tone**

The **↓ PDF** button exports the rendered summary as a dark-themed PDF.

Summaries are cached in `db/summaries/{book_id}/ch{N}.json` and deleted along with the book when removed from the library.

### Character Profile

Profiles can be opened from three places: the **Profiles** tab (avatar grid), the **Characters** tab (Profile button on each row), or the character info panel that appears when you click a node.

The profile is rendered as a styled literary card with sections:

- **Identity** · **Personality & Motivation** · **Background** · **Relationships**
- **Character Arc** · **Key Moments** · **Notable Quotes**

Profiles are cached in `db/profiles/{book_id}/{character}.json`. The **↻ Regenerate** button forces a fresh run. The **↓ PDF** button exports the rendered card as a dark-themed PDF via the browser print dialog — no extra software required.

The **Profiles** tab shows a role-colored avatar grid (purple = protagonist, red = antagonist, teal = supporting, dark = minor) with a violet dot on characters whose profile is already cached.

---

## Library

The library page shows all indexed books with:

- **Cover image** — extracted from the book or fetched from Google Books
- **Stats** — chapter count and indexed passage count
- **Click to analyse** — clicking anywhere on a book card opens Book Analysis for that book; if a cached map exists it loads immediately, otherwise the Start Analysis prompt is shown
- **Quick-links** — cached character maps (🕸️ Map) and profiles (👤 Name) shown as buttons; clicking opens the cached result instantly

---

## LLM configuration

Settings are stored in `config.toml` in the project root. You can edit the file directly or use the **Settings** panel in the web UI.

```toml
[llm]
provider = "anthropic"   # anthropic | openai | gemini | local

[anthropic]
api_key       = ""       # leave empty to use ANTHROPIC_API_KEY env var
answer_model  = "claude-sonnet-4-6"
expand_model  = "claude-haiku-4-5-20251001"
context_limit = 0        # 0 = use model default

[openai]
api_key       = ""
base_url      = "https://api.openai.com/v1"
answer_model  = "gpt-4o"
expand_model  = "gpt-4o-mini"
context_limit = 0

[gemini]
api_key       = ""
answer_model  = "gemini-2.0-flash"
expand_model  = "gemini-2.0-flash"
context_limit = 0

[local]
base_url      = "http://localhost:8080/v1"
api_key       = "no-key"
answer_model  = "local"
expand_model  = "local"
context_limit = 50000    # must match --ctx-size used when launching llama-server
```

### Using a local model (llama.cpp)

```bash
llama-server -m your-model.gguf --port 8080 --ctx-size 50000
```

Then set `provider = "local"` and `context_limit = 50000` in `config.toml`.

### Timeouts

All providers have HTTP timeouts configured to prevent indefinite hangs:

| Provider | Connect | Read |
|----------|---------|------|
| anthropic / openai / gemini | 10 s | 120 s |
| local (llama.cpp / Ollama) | 30 s | 300 s |

If a model takes longer than the read timeout, the request fails with a clear error rather than hanging forever. Local models get a longer timeout to accommodate cold-start loading.

### Using Ollama

```toml
[local]
base_url      = "http://localhost:11434/v1"
answer_model  = "llama3.2"
expand_model  = "llama3.2"
context_limit = 8192
```

---

## MCP server (Claude Desktop)

BookGraph exposes three MCP tools so Claude Desktop can query your library directly.

| Tool | Description |
|------|-------------|
| `search_books` | Answer a question from the book library (multi-query expansion + re-ranking applied automatically) |
| `list_books` | Return the list of indexed books |
| `get_chapter` | Retrieve the full text of a specific chapter by number |

### Setup

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bookgraph": {
      "command": "uv",
      "args": ["--project", "/path/to/BookGraph", "run", "/path/to/BookGraph/mcp_server.py"]
    }
  }
}
```

Replace both occurrences of `/path/to/BookGraph` with the actual path to this project. The full path to `mcp_server.py` is required — Claude Desktop does not set a working directory, so a relative filename will not be found.

### HTTP transport (for testing)

```bash
uv run mcp_server.py --http    # starts on http://127.0.0.1:9000
```

---

## Project structure

```
BookGraph/
├── app.py              Web UI (FastAPI + SSE)
├── ingest.py           CLI ingest tool
├── query.py            CLI query tool + shared retrieval helpers
├── llm.py              LLM abstraction (Anthropic / OpenAI / Gemini / local)
├── mcp_server.py       MCP server for Claude Desktop
├── storage.py          SQLite storage and JSON cache layer
├── config.toml         LLM configuration (created on first settings save)
├── pyproject.toml      Python dependencies
├── static/
│   └── literarIA-circle.png App logo (served at /static/)
├── templates/
│   └── index.html      Single-page web UI
└── db/
    ├── bookgraph.db     SQLite books, sections, and JSON analysis cache
    ├── books.json       Legacy book registry fallback
    ├── chroma/          Local ChromaDB vector store, if enabled
    ├── sections/        Legacy section JSON fallback
    ├── maps/            Legacy character map JSON fallback
    ├── covers/          Book cover images (jpg/png, one per book)
    ├── profiles/        Legacy character profile JSON fallback
    └── summaries/       Legacy chapter summary JSON fallback
```

---

## Supported languages

| Code | Language | Notes |
|------|----------|-------|
| `en` | English | Default |
| `es` | Spanish | Auto-detected; all prompts and output adapt |
| `fr` | French | Auto-detected; all prompts and output adapt |
| `other` | Other | Falls back to English prompts |

Language is stored per-book in SQLite and per-passage in vector metadata.

The web UI itself can be switched between **English** and **Spanish** using the EN/ES toggle in the sidebar. The preference is saved in the browser's `localStorage`.

---

## Deleting a book

In the web UI, click **Remove** on any book card. This deletes:
- All passages from the configured vector store
- The SQLite book, section, and analysis cache rows
- The legacy section text file (`db/sections/{book_id}.json`)
- The legacy character map cache (`db/maps/{book_id}.json`)
- The cover image (`db/covers/{book_id}.jpg` or `.png`)
- Legacy cached character profiles (`db/profiles/{book_id}/`)
- Legacy cached chapter summaries (`db/summaries/{book_id}/`)
- The legacy entry in `db/books.json`

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `sentence-transformers` | Embedding (`multilingual-e5-large`) and reranking (`mmarco-mMiniLMv2`) |
| `chromadb` | Local vector store |
| `qdrant-client` | Remote Qdrant vector store |
| `pymupdf` | PDF parsing and cover extraction |
| `ebooklib` + `beautifulsoup4` | EPUB parsing and cover extraction |
| `fastapi` + `uvicorn` | Web server and SSE streaming |
| `anthropic` / `openai` | LLM clients |
| `mcp[cli]` | MCP server |
| `json-repair` | Fault-tolerant JSON parsing for LLM output |
| `langdetect` | Book language auto-detection |
| `rich` | CLI progress display |
| `click` | CLI argument parsing |
