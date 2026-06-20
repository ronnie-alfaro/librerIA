import type { QuerySource } from '../types';

type Props = {
  sources: QuerySource[];
};

export function SourceList({ sources }: Props) {
  return (
    <div className="source-list">
      <div className="source-title">
        <span className="insight-badge evidence">Evidencia</span>
        Fuentes recuperadas
      </div>
      {sources.map((source, index) => (
        <div className="source-item" key={`${source.book}-${source.chapter}-${index}`}>
          <span>{index + 1}</span>
          <div>
            <strong>{source.book}</strong>
            <p>{source.chapter}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
