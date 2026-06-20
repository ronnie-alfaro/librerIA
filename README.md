# librerIA

librerIA es una aplicación local para convertir libros en una biblioteca inteligente. Permite subir PDF o EPUB, indexarlos semánticamente, hacer preguntas con fuentes, generar mapas de relaciones entre personajes, perfiles narrativos, líneas de tiempo y resúmenes visuales por capítulo.

El proyecto combina un backend en FastAPI con un frontend moderno en React + TypeScript. Los vectores viven en Qdrant o Chroma, mientras que SQLite guarda libros, secciones, cachés de análisis y cachés de recuperación.

## Qué Hace

- Ingesta libros PDF y EPUB desde la interfaz web o CLI.
- Divide el libro en secciones y pasajes para búsqueda semántica.
- Genera embeddings con `intfloat/multilingual-e5-large`.
- Recupera contexto con búsqueda vectorial y re-ranking.
- Responde preguntas en streaming con fuentes.
- Construye un mapa de relaciones con Cytoscape.
- Genera un atlas de personajes con roles, presencia narrativa y vínculos.
- Crea fichas de personajes tipo RPG/literarias.
- Genera una línea de tiempo visual con eventos clave.
- Resume capítulos con secciones renderizadas, no markdown crudo.
- Guarda cachés en SQLite para no regenerar análisis innecesariamente.
- Soporta Qdrant Cloud como vector DB remota.
- Tiene modo claro/oscuro y UI en español.

## Stack

Backend:

- FastAPI
- SQLite con columnas JSON
- Qdrant o Chroma como vector store
- Sentence Transformers
- CrossEncoder para re-ranking
- SSE para streaming de ingesta, preguntas y análisis
- Integración LLM con OpenAI, Anthropic, Gemini o proveedores compatibles

Frontend:

- React
- TypeScript
- Vite
- TanStack Query
- Zustand
- Zod
- Cytoscape
- lucide-react

## Arquitectura

```text
PDF / EPUB
   |
   v
ingest.py
   |
   +--> parseo y capítulos
   +--> secciones largas para contexto
   +--> pasajes cortos para embeddings
   |
   v
Vector DB: Qdrant o Chroma
SQLite: libros, secciones, cachés
   |
   v
FastAPI + SSE
   |
   v
React / TypeScript UI
```

## Flujo de Datos

1. El usuario sube un PDF o EPUB.
2. El backend extrae texto, capítulos y portada.
3. El texto se divide en secciones y pasajes.
4. Los pasajes se vectorizan y se guardan en Qdrant o Chroma.
5. Las secciones y metadatos se guardan en SQLite.
6. Las preguntas usan expansión de consulta, búsqueda vectorial y re-ranking.
7. El LLM recibe secciones completas como contexto.
8. Los análisis de mapa, perfiles, timeline y capítulos se guardan en caché.

## Instalación

Requisitos:

- Python 3.11+
- `uv`
- Node.js 20+
- Una clave de LLM o proveedor local compatible

```bash
git clone git@github.com:ronnie-alfaro/librerIA.git
cd librerIA
uv sync
cd frontend
npm install
```

## Configuración

Crea un archivo `.env` local para variables sensibles. Este archivo no debe commitearse.

Ejemplo con Qdrant:

```bash
VECTOR_STORE=qdrant
QDRANT_URL=https://your-cluster.cloud.qdrant.io
QDRANT_API_KEY=your-api-key
QDRANT_COLLECTION=passages
```

Ejemplo para LLM:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your-key
```

También se puede configurar desde la vista de Ajustes de la aplicación.

## Correr en Desarrollo

Backend:

```bash
uv run app.py
```

Frontend:

```bash
cd frontend
npm run dev
```

La aplicación queda disponible en:

```text
http://localhost:8000
```

Si usas Vite directamente durante desarrollo, el frontend puede servirse desde el puerto que indique `npm run dev`.

## Build de Frontend

```bash
cd frontend
npm run build
```

El backend sirve `frontend/dist` cuando existe.

## Comandos CLI

Ingestar un libro:

```bash
uv run ingest.py libro.pdf
uv run ingest.py libro.epub --title "La casa de los espíritus" --author "Isabel Allende"
```

Preguntar desde terminal:

```bash
uv run query.py "¿Quién es Clara?"
uv run query.py "¿Qué relaciones definen a Alba?" --book "La casa de los espíritus"
```

Servidor MCP:

```bash
uv run mcp_server.py
```

## Funciones Principales

### Biblioteca

La biblioteca permite subir libros, ver estado de indexación, portada, capítulos, pasajes y perfiles generados. Al hacer click en un libro se abre su Vista general.

### Vista General

La Vista general es la portada operativa de cada libro. Muestra:

- Estado del análisis.
- Portada y autor.
- Capítulos y pasajes.
- Densidad de lectura.
- Accesos a mapa, preguntas, capítulos y personajes.
- Ruta sugerida para explorar el libro.

### Preguntar

Permite hacer preguntas al libro o a toda la biblioteca. Las respuestas se transmiten en vivo, se renderizan como contenido estructurado y muestran fuentes recuperadas.

### Mapa

Genera un mapa interactivo de relaciones entre personajes usando Cytoscape. Los nodos representan personajes y las aristas representan vínculos familiares, románticos, aliados, rivales, enemigos o neutros.

### Personajes

El Atlas de personajes agrupa y ordena personajes por relevancia narrativa, rol y cantidad de conexiones. Desde cada card se puede abrir una ficha completa.

### Fichas de Personaje

Cada ficha muestra:

- Identidad.
- Personalidad y motivación.
- Trasfondo.
- Relaciones.
- Arco del personaje.
- Momentos clave.
- Citas destacadas.

El diseño usa secciones visuales con iconos y acentos por tipo de información.

### Línea de Tiempo

Muestra los eventos clave del libro como una experiencia visual. Diferencia clímax, resolución, epílogo y eventos narrativos relevantes.

### Capítulos

Permite generar resúmenes por capítulo. El markdown del modelo se convierte en UI estructurada con panorama, eventos clave, temas, personajes y citas.

## Almacenamiento

SQLite guarda:

- Libros.
- Secciones.
- Caché de análisis.
- Caché de recuperación.

La base local por defecto es:

```text
db/libreria.db
```

Qdrant o Chroma guardan los vectores de pasajes.

## Variables Importantes

```bash
VECTOR_STORE=qdrant|chroma
QDRANT_URL=
QDRANT_API_KEY=
QDRANT_COLLECTION=passages
LLM_PROVIDER=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
```

## Seguridad

No commitear:

- `.env`
- `db/`
- `frontend/node_modules/`
- `frontend/dist/`
- `.venv/`
- cachés locales

El `.gitignore` ya excluye estos archivos.

## Estado Actual

El proyecto está orientado a uso local/desarrollo. La base técnica actual prioriza:

- UX madura en español.
- Qdrant remoto para vectores.
- SQLite como estado local estructurado.
- Cachés para reducir llamadas al LLM.
- Frontend TypeScript con validación de datos.
- Análisis literario enriquecido.

## Próximas Mejoras Posibles

- Autenticación y usuarios.
- Deploy gestionado del backend.
- Migración opcional de SQLite a Postgres.
- Workers para análisis largos.
- Exportación de fichas/timeline.
- Wiki técnica del proyecto.
- Tests automatizados de backend y frontend.

