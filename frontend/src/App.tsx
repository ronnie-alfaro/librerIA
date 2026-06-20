import { useEffect, useMemo } from 'react';
import {
  BarChart3,
  BookOpen,
  Boxes,
  Library,
  Moon,
  Network,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import { BookAnalysisView } from './views/BookAnalysisView';
import { LibraryView } from './views/LibraryView';
import { QueryView } from './views/QueryView';
import { SearchView } from './views/SearchView';
import { SettingsView } from './views/SettingsView';
import { useBooks } from './hooks/useBooks';
import { useThemeStore, useWorkspaceStore } from './stores';
import type { Book, WorkspaceTab } from './domain';

const workspaceTabs: Array<{ id: WorkspaceTab; label: string; icon: typeof BookOpen }> = [
  { id: 'overview', label: 'Vista general', icon: Boxes },
  { id: 'ask', label: 'Preguntar', icon: Sparkles },
  { id: 'graph', label: 'Mapa', icon: Network },
  { id: 'timeline', label: 'Línea de tiempo', icon: BarChart3 },
  { id: 'characters', label: 'Personajes', icon: Users },
  { id: 'chapters', label: 'Capítulos', icon: BookOpen },
];

export function App() {
  const { books } = useBooks();
  const { activeView, activeBookId, activeTab, setBook, setView, setTab } = useWorkspaceStore();
  const { mode, setMode, resolvedMode } = useThemeStore();

  const activeBook = useMemo(
    () => books.find((book) => book.id === activeBookId) || books[0],
    [books, activeBookId],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedMode();
  }, [mode, resolvedMode]);

  function openWorkspace(bookId?: string, tab: WorkspaceTab = 'overview') {
    if (bookId) setBook(bookId);
    else if (activeBook) setBook(activeBook.id);
    setTab(tab);
  }

  return (
    <div className="product-shell">
      <aside className="product-sidebar">
        <button className="brand-mark" onClick={() => setView('library')} aria-label="Abrir biblioteca">
          <img src="/static/librerIA-circle.png" alt="librerIA" />
        </button>

        <nav className="primary-nav" aria-label="Navegación principal">
          <NavButton active={activeView === 'library'} icon={Library} label="Biblioteca" onClick={() => setView('library')} />
          <NavButton active={activeView === 'workspace'} icon={BookOpen} label="Libro activo" onClick={() => openWorkspace()} />
          <NavButton active={activeView === 'search'} icon={Search} label="Buscar" onClick={() => setView('search')} />
          <NavButton active={activeView === 'settings'} icon={Settings} label="Ajustes" onClick={() => setView('settings')} />
        </nav>

        <div className="sidebar-card">
          <span className="micro-label">Motor semántico</span>
          <strong>Qdrant + SQLite</strong>
          <p>Búsqueda semántica remota, secciones y cachés locales.</p>
        </div>
      </aside>

      <div className="product-main">
        <header className="topbar">
          <div>
            <span className="micro-label">Espacio librerIA</span>
            <h1>{topbarTitle(activeView, activeTab, activeBook)}</h1>
          </div>
          <div className="topbar-actions">
            {activeBook && (
              <button className="book-switcher" onClick={() => openWorkspace(activeBook.id)}>
                <span>{activeBook.title}</span>
                <small>{activeBook.author}</small>
              </button>
            )}
            <button className="theme-toggle" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} aria-label="Cambiar tema">
              {resolvedMode() === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        {activeView === 'workspace' && activeBook && (
          <nav className="workspace-tabs" aria-label="Secciones del libro">
            {workspaceTabs.map((item) => (
              <button
                className={activeTab === item.id ? 'active' : ''}
                onClick={() => setTab(item.id)}
                key={item.id}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            ))}
          </nav>
        )}

        <main className="workspace-content">
          {activeView === 'library' && (
            <LibraryView
              onOpenBook={(bookId) => openWorkspace(bookId, 'overview')}
              onAnalyze={(bookId) => openWorkspace(bookId, 'graph')}
            />
          )}
          {activeView === 'search' && <SearchView />}
          {activeView === 'settings' && <SettingsView />}
          {activeView === 'workspace' && (
            activeBook ? (
              <BookWorkspace book={activeBook} tab={activeTab} onTab={setTab} />
            ) : (
              <div className="empty-state mature-empty">
                <h3>No hay libro activo</h3>
                <p>Agrega o selecciona un libro desde la Biblioteca.</p>
              </div>
            )
          )}
        </main>
      </div>
    </div>
  );
}

function BookWorkspace({ book, tab, onTab }: { book: Book; tab: WorkspaceTab; onTab: (tab: WorkspaceTab) => void }) {
  if (tab === 'overview') return <BookOverview book={book} onTab={onTab} />;
  if (tab === 'ask') return <QueryView />;
  if (tab === 'graph') return <BookAnalysisView initialBookId={book.id} initialTab="map" embedded />;
  if (tab === 'timeline') return <BookAnalysisView initialBookId={book.id} initialTab="timeline" embedded />;
  if (tab === 'characters') return <BookAnalysisView initialBookId={book.id} initialTab="characters" embedded />;
  return <BookAnalysisView initialBookId={book.id} initialTab="chapters" embedded />;
}

function BookOverview({ book, onTab }: { book: Book; onTab: (tab: WorkspaceTab) => void }) {
  const profileCount = book.profiles?.length || 0;
  const isIndexed = book.passages > 0;
  const readiness = book.has_map ? 'Listo para explorar' : isIndexed ? 'Listo para analizar' : 'Falta indexar';
  const density = readingDensity(book);
  return (
    <section className="book-overview">
      <div className="overview-hero">
        <div className="overview-cover">
          {book.has_cover ? <img src={`/api/books/${book.id}/cover`} alt="" /> : <span>{book.title.slice(0, 1)}</span>}
        </div>
        <div className="overview-copy">
          <div className="overview-kickers">
            <span className="insight-badge">{readiness}</span>
            <span className="insight-badge quiet">{book.language ? languageName(book.language) : 'Idioma no definido'}</span>
          </div>
          <span className="micro-label">Libro activo</span>
          <h2>{book.title}</h2>
          <p>Por {book.author || 'Autor desconocido'}</p>
          <div className="overview-storyline">
            <span>{book.chapters} capítulos</span>
            <span>{book.passages} pasajes recuperables</span>
            <span>{density}</span>
          </div>
          <div className="overview-actions">
            <button className="button" onClick={() => onTab('graph')}>
              {book.has_map ? 'Explorar mapa' : 'Preparar análisis'}
            </button>
            <button className="button secondary" onClick={() => onTab('ask')}>Preguntar</button>
            <button className="button secondary" onClick={() => onTab('chapters')}>Ver capítulos</button>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <Metric label="Capítulos" value={book.chapters} />
        <Metric label="Pasajes" value={book.passages} />
        <Metric label="Perfiles" value={profileCount} />
        <Metric label="Mapa" value={book.has_map ? 'Listo' : 'Pendiente'} />
      </div>

      <div className="overview-dashboard">
        <article className="overview-panel overview-primary">
          <span className="micro-label">Ruta sugerida</span>
          <h3>{book.has_map ? 'Empieza por el mapa de relaciones' : 'Construye el análisis literario'}</h3>
          <p>
            {book.has_map
              ? 'Ya existe una lectura estructurada del libro. Desde aquí puedes saltar al mapa, abrir fichas de personajes o seguir el arco narrativo.'
              : 'Este libro tiene pasajes indexados. Ejecuta el análisis para descubrir personajes, vínculos, eventos y puntos clave.'}
          </p>
          <div className="overview-path">
            <button className="path-step active" onClick={() => onTab('graph')}>
              <span>01</span>
              <strong>Relaciones</strong>
              <small>Mapa interactivo</small>
            </button>
            <button className="path-step" onClick={() => onTab('characters')}>
              <span>02</span>
              <strong>Personajes</strong>
              <small>Atlas y fichas</small>
            </button>
            <button className="path-step" onClick={() => onTab('timeline')}>
              <span>03</span>
              <strong>Línea narrativa</strong>
              <small>Eventos clave</small>
            </button>
          </div>
        </article>

        <aside className="overview-insights">
          <OverviewInsight icon="💬" title="Preguntas con fuentes" text="Haz preguntas al libro y revisa las secciones recuperadas que sostienen la respuesta." action="Preguntar" onClick={() => onTab('ask')} />
          <OverviewInsight icon="📖" title="Resumen por capítulos" text="Lee el libro por partes con resúmenes visuales, eventos y temas de cada capítulo." action="Capítulos" onClick={() => onTab('chapters')} />
          <OverviewInsight icon="🎭" title="Perfiles de personajes" text="Abre fichas tipo RPG con motivaciones, relaciones, arco y citas destacadas." action="Personajes" onClick={() => onTab('characters')} />
        </aside>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OverviewInsight({ icon, title, text, action, onClick }: { icon: string; title: string; text: string; action: string; onClick: () => void }) {
  return (
    <article className="overview-insight">
      <span className="overview-insight-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      <button className="button secondary compact" onClick={onClick}>{action}</button>
    </article>
  );
}

function NavButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof BookOpen; label: string; onClick: () => void }) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );
}

function topbarTitle(view: string, tab: WorkspaceTab, book?: Book) {
  if (view === 'library') return 'Biblioteca';
  if (view === 'search') return 'Búsqueda semántica';
  if (view === 'settings') return 'Ajustes';
  if (!book) return 'Espacio de lectura';
  const tabName = workspaceTabs.find((item) => item.id === tab)?.label || 'Vista general';
  return `${book.title} · ${tabName}`;
}

function languageName(language: string) {
  const names: Record<string, string> = {
    es: 'Español',
    en: 'Inglés',
    fr: 'Francés',
    other: 'Otro idioma',
  };
  return names[language] || language;
}

function readingDensity(book: Book) {
  if (!book.chapters) return 'Estructura pendiente';
  const passagesPerChapter = book.passages / Math.max(book.chapters, 1);
  if (passagesPerChapter >= 18) return 'Lectura densa';
  if (passagesPerChapter >= 8) return 'Lectura equilibrada';
  return 'Lectura ligera';
}
