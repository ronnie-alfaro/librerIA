import type { QueryStreamEvent } from '../types';

type QueryPayload = {
  question: string;
  bookTitle: string;
  topK: number;
};

export async function streamQuery(
  payload: QueryPayload,
  onEvent: (event: QueryStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/query/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: payload.question,
      book_title: payload.bookTitle,
      top_k: payload.topK,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`No se pudo iniciar la consulta (${response.status}). Reinicia el backend si acabas de actualizar la app.`);
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
      try {
        onEvent(JSON.parse(line.slice(6)) as QueryStreamEvent);
      } catch {
        throw new Error('El servidor envió una respuesta inválida durante la consulta.');
      }
    }
  }
}
