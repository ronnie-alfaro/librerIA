import {
  bookSchema,
  chapterSchema,
  characterMapSchema,
  llmConfigSchema,
  llmModelsSchema,
  searchResultSchema,
  type Book,
  type Chapter,
  type LlmConfig,
  type LlmModels,
  type SearchResult,
  type TaskStreamEvent,
} from '../domain';

async function readJson(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`El servidor devolvió una respuesta no válida (${response.status}). Reinicia el backend y vuelve a intentar.`);
  }
}

export async function fetchBooks(): Promise<Book[]> {
  const response = await fetch('/api/books');
  if (!response.ok) {
    throw new Error('No se pudo cargar la biblioteca.');
  }
  return bookSchema.array().parse(await readJson(response));
}

export async function deleteBook(bookId: string): Promise<void> {
  const response = await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error('No se pudo eliminar el libro.');
  }
}

export async function startIngest(file: File, title: string, author: string, language: string): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('title', title);
  form.append('author', author);
  form.append('language', language);

  const response = await fetch('/api/ingest', { method: 'POST', body: form });
  const data = await readJson(response).catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.detail || 'No se pudo subir el libro.');
  }
  if (!data.job_id) {
    throw new Error('La subida no devolvió un identificador de tarea.');
  }

  return data.job_id;
}

export async function searchLibrary(query: string, bookId: string, topK: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, top_k: String(topK) });
  if (bookId) params.set('book_id', bookId);

  const response = await fetch(`/api/search?${params}`);
  if (!response.ok) {
    throw new Error('La búsqueda falló.');
  }
  const data = await readJson(response);
  return searchResultSchema.array().parse(data.results || []);
}

export async function fetchConfig(): Promise<LlmConfig> {
  const response = await fetch('/api/config');
  if (!response.ok) {
    throw new Error('No se pudieron cargar los ajustes.');
  }
  return llmConfigSchema.parse(await readJson(response));
}

export async function saveConfig(payload: Partial<LlmConfig> & { api_key?: string }): Promise<void> {
  const response = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await readJson(response).catch(() => ({}));
    throw new Error(data.error || 'No se pudieron guardar los ajustes.');
  }
}

export async function fetchConfigModels(payload: Partial<LlmConfig> & { api_key?: string }): Promise<LlmModels> {
  const response = await fetch('/api/config/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await readJson(response).catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'No se pudieron cargar los modelos.');
  }
  return llmModelsSchema.parse(data);
}

export async function fetchChapters(bookId: string): Promise<Chapter[]> {
  const response = await fetch(`/api/books/${bookId}/chapters`);
  if (!response.ok) {
    throw new Error('No se pudieron cargar los capítulos.');
  }
  return chapterSchema.array().parse(await readJson(response));
}

export async function streamTask(url: string, onEvent: (event: TaskStreamEvent) => void): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error('No se pudo iniciar la tarea.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let parsed: TaskStreamEvent;
      try {
        parsed = JSON.parse(line.slice(6)) as TaskStreamEvent;
      } catch {
        throw new Error('El servidor envió un evento inválido. Reinicia el backend e intenta de nuevo.');
      }
      if ('data' in parsed && parsed.data) {
        parsed.data = characterMapSchema.parse(parsed.data);
      }
      onEvent(parsed);
    }
  }
}
