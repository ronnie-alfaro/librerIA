# librerIA

librerIA is a local-first book intelligence app that turns PDFs and EPUBs into an explorable library. It indexes books semantically, answers questions with sources, and generates character maps, character sheets, timelines, chapter summaries, and relationship analysis.

The current stack is:

- FastAPI backend
- React + TypeScript frontend
- SQLite for books, sections, caches, and structured app state
- Qdrant for vector search
- LLM providers such as OpenAI, Anthropic, Gemini, or compatible local endpoints

## What It Does

- Upload PDF or EPUB books from the web app.
- Extract chapters, sections, and passages for retrieval.
- Generate semantic embeddings and store them in Qdrant.
- Answer questions in streaming mode with citations.
- Build character relationship maps with Cytoscape.
- Generate a narrative timeline of the story.
- Render character sheets with identity, traits, relationships, arc, and quotes.
- Produce chapter summaries rendered as structured UI instead of raw markdown.
- Cache analyses in SQLite so repeated work is fast.
- Support both local and remote LLM providers.
- Offer a clean light/dark interface.

## Repository Layout

```text
app.py              FastAPI app and streaming analysis endpoints
ingest.py           PDF/EPUB parsing and chunking
query.py            Retrieval, reranking, and terminal Q&A
llm.py              Provider abstraction and model selection
storage.py          SQLite persistence and analysis cache
frontend/           React + TypeScript UI
db/                 Local database, cached analysis, and book assets
```

## Requirements

- Python 3.11+
- `uv`
- Node.js 20+
- A supported LLM provider or local model endpoint
- Qdrant Cloud or a local Qdrant instance

## Quick Start

```bash
git clone git@github.com:ronnie-alfaro/librerIA.git
cd librerIA
uv sync
cd frontend
npm install
```

Create a local `.env` file or configure the app from the UI settings page.

## Configuration

Example vector store settings:

```bash
VECTOR_STORE=qdrant
QDRANT_URL=https://your-cluster.cloud.qdrant.io
QDRANT_API_KEY=your-api-key
QDRANT_COLLECTION=passages
```

Example LLM settings:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your-key
```

You can also set the provider, models, and base URL from the in-app Settings screen.

## Run Locally

Backend:

```bash
uv run app.py
```

Frontend:

```bash
cd frontend
npm run dev
```

Default URL:

```text
http://localhost:8000
```

## CLI

Ingest a book:

```bash
uv run ingest.py book.pdf
uv run ingest.py book.epub --title "The House of the Spirits" --author "Isabel Allende"
```

Ask questions from the terminal:

```bash
uv run query.py "Who is Clara?"
uv run query.py "What relationships define Alba?" --book "The House of the Spirits"
```

Run the MCP server:

```bash
uv run mcp_server.py
```

## Documentation

For a full end-to-end user guide, see the internal wiki:

- [Wiki Guide](docs/WIKI.md)

## Storage

SQLite stores:

- Books
- Sections
- Retrieval cache
- Analysis cache

Local database file:

```text
db/libreria.db
```

Qdrant stores vector embeddings for passages.

## Security

Do not commit:

- `.env`
- `db/`
- `frontend/node_modules/`

