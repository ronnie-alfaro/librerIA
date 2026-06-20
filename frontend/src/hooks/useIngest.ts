import { useCallback, useState } from 'react';
import { startIngest } from '../api/client';
import type { IngestEvent, IngestState } from '../types';

const initialState: IngestState = {
  active: false,
  fileName: '',
  stage: 'Inactivo',
  message: '',
  progress: 0,
  error: null,
};

const stageProgress: Record<string, number> = {
  parsing: 12,
  chunking: 32,
  embedding: 58,
  storing: 88,
};

export function useIngest(onComplete: () => void) {
  const [state, setState] = useState<IngestState>(initialState);

  const ingest = useCallback(
    async (file: File, title: string, author: string, language: string) => {
      setState({
        active: true,
        fileName: file.name,
        stage: 'Subiendo',
        message: 'Subiendo libro...',
        progress: 6,
        error: null,
      });

      try {
        const jobId = await startIngest(file, title, author, language);
        const events = new EventSource(`/api/ingest/${jobId}`);

        events.onmessage = (event) => {
          let data: IngestEvent;
          try {
            data = JSON.parse(event.data) as IngestEvent;
          } catch {
            events.close();
            setState((current) => ({
              ...current,
              stage: 'Error',
              message: 'El servidor envió un evento inválido durante la indexación.',
              progress: 0,
              error: 'El servidor envió un evento inválido durante la indexación.',
            }));
            return;
          }

          if (data.error) {
            events.close();
            setState((current) => ({
              ...current,
              stage: 'Error',
              message: data.error || 'La indexación falló.',
              progress: 0,
              error: data.error || 'La indexación falló.',
            }));
            return;
          }

          if (data.done) {
            events.close();
            setState((current) => ({
              ...current,
              stage: 'Listo',
              message: data.msg || 'Libro indexado.',
              progress: 100,
              error: null,
            }));
            window.setTimeout(() => {
              setState(initialState);
              onComplete();
            }, 900);
            return;
          }

          setState((current) => ({
            ...current,
            stage: data.stage ? translateStage(data.stage) : current.stage,
            message: data.msg ? translateIngestMessage(data.msg) : current.message,
            progress: data.stage ? stageProgress[data.stage] || current.progress : current.progress,
            error: null,
          }));
        };

        events.onerror = () => {
          events.close();
          setState((current) => ({
            ...current,
            stage: 'Error',
            message: 'Se perdió la conexión mientras se seguía la indexación.',
            progress: 0,
            error: 'Se perdió la conexión mientras se seguía la indexación.',
          }));
        };
      } catch (err) {
        setState((current) => ({
          ...current,
          stage: 'Error',
          message: err instanceof Error ? err.message : 'La subida falló.',
          progress: 0,
          error: err instanceof Error ? err.message : 'La subida falló.',
        }));
      }
    },
    [onComplete],
  );

  const clear = useCallback(() => setState(initialState), []);

  return { state, ingest, clear };
}

function translateStage(stage: string) {
  const labels: Record<string, string> = {
    parsing: 'Leyendo',
    chunking: 'Dividiendo',
    embedding: 'Vectorizando',
    storing: 'Guardando',
  };
  return labels[stage] || stage;
}

function translateIngestMessage(message: string) {
  return message
    .replace(/^Parsing (.+)…$/, 'Leyendo $1...')
    .replace(/^Found (\d+) chapters — chunking…$/, 'Se encontraron $1 capítulos; dividiendo...')
    .replace(/^Embedding (\d+) passages…$/, 'Vectorizando $1 pasajes...')
    .replace('Storing in vector database…', 'Guardando en la base vectorial...')
    .replace('Done!', 'Listo');
}
