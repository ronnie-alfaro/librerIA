import type { Book } from '../types';

type Props = {
  book: Book;
  deleting: boolean;
  onOpen: (bookId: string) => void;
  onAnalyze: (bookId: string) => void;
  onDelete: (bookId: string) => void;
};

const languageNames: Record<string, string> = {
  en: 'Inglés',
  es: 'Español',
  fr: 'Francés',
  other: 'Otro',
};

export function BookCard({ book, deleting, onOpen, onAnalyze, onDelete }: Props) {
  const coverUrl = `/api/books/${book.id}/cover`;
  const profileCount = book.profiles?.length || 0;
  const canAnalyze = book.passages > 0;

  return (
    <article
      className="book-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(book.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(book.id);
        }
      }}
      aria-label={`Abrir vista general de ${book.title}`}
    >
      <div className="book-cover">
        {book.has_cover ? (
          <img src={coverUrl} alt="" loading="lazy" />
        ) : (
          <div className="cover-placeholder">R</div>
        )}
      </div>
      <div className="book-content">
        <div>
          <div className="book-meta-line">
            <span>{languageNames[book.language || ''] || book.language || 'Desconocido'}</span>
            {book.has_map && <span className="pill success">Mapa listo</span>}
          </div>
          <h3>{book.title}</h3>
          <p className="author">{book.author}</p>
        </div>
        <div className="stats-row">
          <span>{book.chapters} capítulos</span>
          <span>{book.passages} pasajes</span>
          <span>{profileCount} perfiles</span>
        </div>
        <div className="book-actions">
          <button
            className="button secondary"
            type="button"
            disabled={!canAnalyze}
            title={canAnalyze ? 'Abrir análisis del libro' : 'Vuelve a ingerir este libro antes de analizarlo'}
            onClick={(event) => {
              event.stopPropagation();
              onAnalyze(book.id);
            }}
          >
            {canAnalyze ? 'Analizar' : 'Sin índice'}
          </button>
          <button
            className="button danger"
            type="button"
            disabled={deleting}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(book.id);
            }}
          >
            {deleting ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </article>
  );
}
