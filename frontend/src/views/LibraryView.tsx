import { BookCard } from '../components/BookCard';
import { EmptyState } from '../components/EmptyState';
import { ProgressCard } from '../components/ProgressCard';
import { UploadDropzone } from '../components/UploadDropzone';
import { useBooks } from '../hooks/useBooks';
import { useIngest } from '../hooks/useIngest';

type Props = {
  onOpenBook: (bookId: string) => void;
  onAnalyze: (bookId: string) => void;
};

export function LibraryView({ onOpenBook, onAnalyze }: Props) {
  const { books, loading, error, deletingId, reload, remove } = useBooks();
  const ingest = useIngest(reload);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Biblioteca librerIA</span>
          <h1>Biblioteca</h1>
          <p>Agrega libros, sigue la indexación y administra tu colección local.</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void reload()}>
          Actualizar
        </button>
      </header>

      <UploadDropzone busy={ingest.state.active && !ingest.state.error} onUpload={ingest.ingest} />
      <ProgressCard state={ingest.state} onDismiss={ingest.clear} />

      {error && <div className="alert">{error}</div>}

      <section className="library-section">
        <div className="section-head">
          <h2>{books.length} libros</h2>
          <span>{loading ? 'Cargando...' : 'Indexados localmente'}</span>
        </div>

        {loading ? (
          <div className="skeleton-grid">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
        ) : books.length ? (
          <div className="book-grid">
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                deleting={deletingId === book.id}
                onOpen={onOpenBook}
                onAnalyze={onAnalyze}
                onDelete={(bookId) => void remove(bookId)}
              />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>
    </div>
  );
}
