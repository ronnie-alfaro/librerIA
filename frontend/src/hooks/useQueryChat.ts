import { useCallback, useRef, useState } from 'react';
import { streamQuery } from '../api/queryStream';
import type { ChatMessage } from '../types';

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useQueryChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (question: string, bookTitle: string, topK: number) => {
    const userId = makeId('user');
    const assistantId = makeId('assistant');
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setMessages((current) => [
      ...current,
      { id: userId, role: 'user', text: question },
      { id: assistantId, role: 'assistant', text: '', stage: 'Iniciando...', error: null },
    ]);

    try {
      await streamQuery(
        { question, bookTitle, topK },
        (event) => {
          setMessages((current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;

              if (event.error) {
                return { ...message, stage: undefined, error: event.error };
              }

              if (event.type === 'text') {
                return { ...message, text: message.text + (event.text || ''), stage: undefined };
              }

              if (event.done) {
                return { ...message, stage: undefined, sources: event.sources || [] };
              }

              if (event.msg) {
                return { ...message, stage: translateQueryStatus(event.msg) };
              }

              return message;
            }),
          );
        },
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                stage: undefined,
                error: err instanceof Error ? err.message : 'La consulta falló.',
              }
            : message,
        ),
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setBusy(false);
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }, []);

  const clear = useCallback(() => {
    stop();
    setMessages([]);
  }, [stop]);

  return { messages, busy, send, stop, clear };
}

function translateQueryStatus(message: string) {
  return message
    .replace('Expanding query…', 'Expandiendo consulta...')
    .replace(/^Searching (\d+) query variants…$/, 'Buscando $1 variantes de consulta...')
    .replace(/^Found (\d+) sections — generating answer…(.*)$/, 'Encontradas $1 secciones; generando respuesta...$2')
    .replace(/^Waiting for (.+) to respond…$/, 'Esperando respuesta de $1...');
}
