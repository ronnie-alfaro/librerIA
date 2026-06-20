import type { IngestState } from '../types';

type Props = {
  state: IngestState;
  onDismiss: () => void;
};

export function ProgressCard({ state, onDismiss }: Props) {
  if (!state.active) return null;

  return (
    <section className={`progress-card ${state.error ? 'error' : ''}`}>
      <div className="progress-head">
        <div>
          <span className="eyebrow">{state.stage}</span>
          <h3>{state.fileName}</h3>
        </div>
        {state.error && (
          <button className="button secondary compact" type="button" onClick={onDismiss}>
            Cerrar
          </button>
        )}
      </div>
      <div className="progress-track" aria-label="Progreso de indexación">
        <div className="progress-fill" style={{ width: `${state.progress}%` }} />
      </div>
      <p>{state.message}</p>
    </section>
  );
}
