import { FormEvent, useMemo, useState } from 'react';
import { ChatMessage } from '../components/ChatMessage';
import { useBooks } from '../hooks/useBooks';
import { useQueryChat } from '../hooks/useQueryChat';

export function QueryView() {
  const { books, loading } = useBooks();
  const chat = useQueryChat();
  const [question, setQuestion] = useState('');
  const [bookTitle, setBookTitle] = useState('');
  const [topK, setTopK] = useState(5);

  const placeholder = useMemo(() => {
    if (bookTitle) return `Pregunta sobre ${bookTitle}...`;
    return 'Pregunta sobre personajes, trama, temas, relaciones o citas...';
  }, [bookTitle]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const q = question.trim();
    if (!q || chat.busy) return;
    setQuestion('');
    void chat.send(q, bookTitle, topK);
  }

  return (
    <div className="page query-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Preguntas con fuentes</span>
          <h1>Preguntar</h1>
          <p>Consulta tu biblioteca local e inspecciona las fuentes recuperadas.</p>
        </div>
        <div className="query-actions">
          {chat.busy ? (
            <button className="button secondary" type="button" onClick={chat.stop}>
              Detener
            </button>
          ) : null}
          <button className="button secondary" type="button" onClick={chat.clear} disabled={!chat.messages.length}>
            Limpiar
          </button>
        </div>
      </header>

      <section className="query-workspace">
        <div className="chat-panel">
          <div className="chat-scroll">
            {chat.messages.length ? (
              chat.messages.map((message) => <ChatMessage key={message.id} message={message} />)
            ) : (
              <div className="query-empty">
                <h3>Empieza con una pregunta</h3>
                <p>Prueba “¿Quién está conectado con la protagonista?” o “¿Qué cambia en el capítulo final?”</p>
              </div>
            )}
          </div>

          <form className="composer" onSubmit={submit}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={placeholder}
              rows={3}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit(event);
                }
              }}
            />
            <div className="composer-footer">
              <span>Enter para enviar · Shift+Enter para nueva línea</span>
              <button className="button" type="submit" disabled={chat.busy || !question.trim()}>
                {chat.busy ? 'Trabajando...' : 'Enviar'}
              </button>
            </div>
          </form>
        </div>

        <aside className="query-sidebar">
          <section className="control-card">
            <label htmlFor="query-book">Filtro por libro</label>
            <select id="query-book" value={bookTitle} onChange={(event) => setBookTitle(event.target.value)}>
              <option value="">Todos los libros</option>
              {books.map((book) => (
                <option value={book.title} key={book.id}>
                  {book.title}
                </option>
              ))}
            </select>
            <p>{loading ? 'Cargando biblioteca...' : `${books.length} libros indexados disponibles.`}</p>
          </section>

          <section className="control-card">
            <div className="range-head">
              <label htmlFor="query-top-k">Secciones recuperadas</label>
              <strong>{topK}</strong>
            </div>
            <input
              id="query-top-k"
              type="range"
              min="1"
              max="12"
              value={topK}
              onChange={(event) => setTopK(Number(event.target.value))}
            />
            <p>Usa más secciones para preguntas de relaciones o temas.</p>
          </section>
        </aside>
      </section>
    </div>
  );
}
