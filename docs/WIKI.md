# librerIA Wiki

This page is the practical user guide for librerIA. It is written as a wiki-style reference so a new user can go from zero to analysis without reading the code.

## 1. What librerIA Is

librerIA is a book analysis platform. You load a PDF or EPUB, the app extracts passages, stores them locally, indexes them in a vector database, and lets you:

- ask questions with sources
- inspect character relationships
- read character sheets
- explore a timeline
- open chapter summaries
- review searchable passages

The app is designed to run locally first and can later move toward a more online, multi-user setup.

## 2. Core Concepts

### Books

A book is the top-level unit. It has:

- title
- author
- language
- chapters
- passages
- cover image
- cached analysis data

### Sections and Passages

The ingestion pipeline splits the book into:

- long sections used for reasoning and generation
- shorter passages used for vector search

Sections stay in SQLite. Passages are embedded and stored in Qdrant.

### Analysis Cache

Analysis results are cached so the app does not regenerate the same output every time. Cached items include:

- character maps
- character profiles
- chapter summaries

## 3. First-Time Setup

### Install dependencies

```bash
uv sync
cd frontend
npm install
```

### Configure a vector database

Use Qdrant for semantic search.

```bash
VECTOR_STORE=qdrant
QDRANT_URL=https://your-cluster.cloud.qdrant.io
QDRANT_API_KEY=your-api-key
QDRANT_COLLECTION=passages
```

### Configure an LLM provider

Example:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your-key
```

You can also change provider and models from the Settings page in the app.

## 4. Running the App

### Backend

```bash
uv run app.py
```

### Frontend

```bash
cd frontend
npm run dev
```

Open the app in your browser at the URL shown by Vite or at the backend URL if the frontend is proxied there.

## 5. Uploading a Book

1. Open the Library.
2. Upload a PDF or EPUB.
3. Fill in title, author, and language if needed.
4. Wait for ingestion to finish.

During ingestion the app:

- parses the file
- detects chapters
- splits text into sections and passages
- embeds passages
- stores metadata and caches

## 6. Open a Book

Click any book in the Library to enter its workspace.

The workspace includes:

- Overview
- Ask
- Map
- Timeline
- Characters
- Chapters

The Overview is the best starting point. It shows the book status and directs you to the next most useful action.

## 7. Ask

Use Ask when you want direct answers from the indexed text.

What it does:

- expands the query
- retrieves relevant passages
- reranks them
- streams the answer
- shows sources

Good questions:

- Who is Clara?
- How does the relationship between X and Y change?
- What themes dominate the ending?

## 8. Map

The Map view builds a character relationship graph.

It shows:

- characters
- relationships
- evidence-backed connections
- narrative events

Use it when you want to understand the cast and the structure of the book.

### Best practice

If the map looks too dense, regenerate it after improving the analysis prompt or after reingesting a cleaner source.

## 9. Timeline

The Timeline is meant to be a narrative experience, not just a list of events.

It highlights:

- important story beats
- climax
- resolution
- epilogue

Use it to understand the structure of the story from beginning to end.

## 10. Characters

The Characters view shows an atlas of the cast.

It includes:

- role
- narrative presence
- short description
- connection count
- relationship chips

From any card you can open the full profile.

## 11. Character Profiles

Character profiles are structured narrative sheets.

They usually include:

- Identity
- Personality and motivation
- Background
- Relationships
- Character arc
- Key moments
- Notable quotes

The current implementation aims to keep the output in Spanish and render it as structured UI instead of raw markdown.

## 12. Chapters

Chapter summaries break each chapter into readable sections:

- overview
- key events
- character moments
- themes and tone

If a chapter was already analyzed, the cached result is shown immediately.

## 13. Search

The Search page lets you search semantically across the library.

You can:

- search all books
- filter by one book
- change the number of results

Search is useful for finding passages, scenes, or quotations without knowing exact wording.

## 14. Settings

Settings control:

- LLM provider
- API key
- model selection
- context limit
- base URL for compatible providers

When you save a provider key, the app fetches available models for that provider so you can choose answer and expansion models.

## 15. CLI Usage

### Ingest

```bash
uv run ingest.py book.pdf
uv run ingest.py book.epub --title "Book Title" --author "Author Name"
```

### Ask

```bash
uv run query.py "Who is the protagonist?"
uv run query.py "How do these characters relate?" --book "Book Title"
```

### MCP server

```bash
uv run mcp_server.py
```

## 16. Data Storage

### SQLite

SQLite stores:

- books
- sections
- retrieval cache
- analysis cache

Default file:

```text
db/librerIA.db
```

### Qdrant

Qdrant stores the vectors used for semantic retrieval.

### Filesystem caches

The app also keeps generated analysis payloads under `db/` for local persistence.

## 17. Performance Notes

If the app feels slow, the usual causes are:

- a large context window
- a slow local LLM
- a heavy chapter or character analysis
- first-time vector indexing

The most effective improvements are:

- use a faster answer model
- keep expansion model lighter
- reduce unnecessary context
- regenerate only when needed

## 18. Troubleshooting

### A book shows no passages

Reingest the file. The sections may not exist yet in SQLite/Qdrant.

### A prompt returns English

Regenerate the analysis. Old cached outputs can remain from previous prompt versions.

### Models do not appear in Settings

Check:

- provider key
- base URL
- network access
- whether the provider exposes a `/models` endpoint

### Search or analysis returns empty

Make sure:

- the book has been ingested
- the vector database is reachable
- the selected provider is valid

## 19. Recommended Workflow

1. Upload a book.
2. Open Overview.
3. Run the map.
4. Open Characters for profiles.
5. Read the timeline.
6. Use Ask for deeper questions.
7. Review chapter summaries when you need local context.

## 20. Roadmap Shape

If the app moves toward multi-user online use, the likely split is:

- Supabase for auth and app metadata
- Qdrant for vectors
- object storage for files
- background worker for indexing and analysis
- local or hosted LLMs depending on cost

