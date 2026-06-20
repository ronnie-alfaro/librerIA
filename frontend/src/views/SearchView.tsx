import { FormEvent, useState } from 'react';
import { searchLibrary } from '../api/client';
import { useBooks } from '../hooks/useBooks';
import type { SearchResult } from '../types';

export function SearchView() {
  const { books } = useBooks();
  const [query, setQuery] = useState('');
  const [bookId, setBookId] = useState('');
  const [topK, setTopK] = useState(10);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await searchLibrary(q, bookId, topK));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La búsqueda falló.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Búsqueda semántica de pasajes</span>
          <h1>Buscar</h1>
          <p>Encuentra pasajes relevantes sin necesitar las palabras exactas.</p>
        </div>
      </header>

      <form className="search-panel" onSubmit={submit}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca en tu biblioteca..." />
        <select value={bookId} onChange={(event) => setBookId(event.target.value)}>
          <option value="">Todos los libros</option>
          {books.map((book) => (
            <option value={book.id} key={book.id}>
              {book.title}
            </option>
          ))}
        </select>
        <label>
          Resultados
          <input type="range" min="1" max="30" value={topK} onChange={(event) => setTopK(Number(event.target.value))} />
          <strong>{topK}</strong>
        </label>
        <button className="button" disabled={loading || !query.trim()}>
          {loading ? 'Buscando...' : 'Buscar'}
        </button>
      </form>

      {error && <div className="alert">{error}</div>}

      <section className="results-list">
        {results.map((result, index) => (
          <article className="result-card" key={`${result.book_id}-${result.chapter_num}-${index}`}>
            <div className="result-head">
              <span className="pill success">{Math.round(result.score * 100)}%</span>
              <strong>{result.book_title}</strong>
              <span>Cap. {result.chapter_num + 1}: {result.chapter_title}</span>
            </div>
            <p>{result.text}</p>
          </article>
        ))}
        {!loading && !results.length && <div className="empty-state"><h3>Aún no hay resultados</h3><p>Ejecuta una búsqueda para ver pasajes relacionados.</p></div>}
      </section>
    </div>
  );
}
