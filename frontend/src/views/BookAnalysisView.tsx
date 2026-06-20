import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchChapters, streamTask } from '../api/client';
import { CharacterGraph } from '../components/CharacterGraph';
import { CharacterSheet } from '../components/CharacterSheet';
import { StoryTimeline } from '../components/StoryTimeline';
import { useBooks } from '../hooks/useBooks';
import type { Chapter, Character, CharacterMapData, Relationship, TaskStreamEvent } from '../types';

type Tab = 'map' | 'timeline' | 'characters' | 'chapters' | 'profile';

type Props = {
  initialBookId?: string;
  initialTab?: Tab;
  embedded?: boolean;
};

export function BookAnalysisView({ initialBookId = '', initialTab = 'map', embedded = false }: Props) {
  const { books } = useBooks();
  const [bookId, setBookId] = useState('');
  const [tab, setTab] = useState<Tab>(initialTab);
  const [mapData, setMapData] = useState<CharacterMapData | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState('');
  const [profile, setProfile] = useState('');
  const [summary, setSummary] = useState('');
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const autoLoadedMapRef = useRef<string | null>(null);

  const selectedBook = useMemo(() => books.find((book) => book.id === bookId), [books, bookId]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (initialBookId && initialBookId !== bookId) {
      setBookId(initialBookId);
      return;
    }
    if (!bookId && books[0]) setBookId(books[0].id);
  }, [books, bookId, initialBookId]);

  useEffect(() => {
    if (!bookId) return;
    setMapData(null);
    setProfile('');
    setSummary('');
    setSelectedChapter(null);
    autoLoadedMapRef.current = null;
    fetchChapters(bookId).then(setChapters).catch(() => setChapters([]));
  }, [bookId]);

  useEffect(() => {
    if (!selectedBook?.has_map || autoLoadedMapRef.current === selectedBook.id) return;
    autoLoadedMapRef.current = selectedBook.id;
    void loadMap(false);
  }, [selectedBook?.id, selectedBook?.has_map]);

  async function loadMap(regen = false) {
    if (!bookId) return;
    setBusy(true);
    setError(null);
    setStatus('Iniciando análisis...');
    try {
      await streamTask(`/api/tasks/character-map/${bookId}${regen ? '?regen=true' : ''}`, (event: TaskStreamEvent) => {
        if (event.error) setError(event.error);
        if (event.msg) setStatus(translateTaskStatus(event.msg));
        if (event.done && event.data) {
          setMapData(event.data);
          setStatus(event.cached ? 'Análisis cargado desde caché.' : 'Análisis completo.');
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'El análisis falló.');
    } finally {
      setBusy(false);
    }
  }

  async function loadProfile(name: string, regen = false) {
    if (!bookId || !name) return;
    setTab('profile');
    setSelectedCharacter(name);
    setProfile('');
    setBusy(true);
    setError(null);
    setStatus(`Construyendo perfil de ${name}...`);
    const params = new URLSearchParams({ character: name });
    if (regen) params.set('regen', 'true');
    try {
      await streamTask(`/api/tasks/character-chart/${bookId}?${params}`, (event) => {
        if (event.error) setError(event.error);
        if (event.msg) setStatus(translateTaskStatus(event.msg));
        if (event.text) setProfile((current) => current + event.text);
        if (event.done) setStatus(event.cached ? 'Perfil cargado desde caché.' : 'Perfil completo.');
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'El perfil falló.');
    } finally {
      setBusy(false);
    }
  }

  async function loadSummary(chapter: Chapter, regen = false) {
    if (!bookId) return;
    setSelectedChapter(chapter);
    setSummary('');
    setBusy(true);
    setError(null);
    setStatus(`Resumiendo ${chapter.title}...`);
    const params = new URLSearchParams({ chapter_num: String(chapter.num) });
    if (regen) params.set('regen', 'true');
    try {
      await streamTask(`/api/tasks/chapter-summary/${bookId}?${params}`, (event) => {
        if (event.error) setError(event.error);
        if (event.msg) setStatus(translateTaskStatus(event.msg));
        if (event.text) setSummary((current) => current + event.text);
        if (event.done) setStatus(event.cached ? 'Resumen cargado desde caché.' : 'Resumen completo.');
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'El resumen falló.');
    } finally {
      setBusy(false);
    }
  }

  const characters = mapData?.characters || [];
  const relationships = mapData?.relationships || [];
  const events = mapData?.events || [];
  const selectedCharacterData = characters.find((char) => char.name === selectedCharacter);
  const canAnalyzeSelected = Boolean(selectedBook?.passages);

  return (
    <div className={embedded ? 'workspace-page embedded-analysis' : 'page'}>
      {!embedded && <header className="page-header">
        <div>
          <span className="eyebrow">Espacio de análisis</span>
          <h1>Análisis del libro</h1>
          <p>Genera mapas, líneas de tiempo, perfiles de personajes y resúmenes de capítulos.</p>
        </div>
        <select className="header-select" value={bookId} onChange={(event) => setBookId(event.target.value)}>
          {books.map((book) => <option value={book.id} key={book.id}>{book.title}</option>)}
        </select>
      </header>}

      {!selectedBook ? <div className="empty-state"><h3>No hay libro seleccionado</h3><p>Agrega primero un libro desde la Biblioteca.</p></div> : (
        <section className="analysis-shell">
          <aside className="analysis-side">
            <img className="analysis-cover" src={`/api/books/${selectedBook.id}/cover`} alt="" />
            <h2>{selectedBook.title}</h2>
            <p>{selectedBook.author}</p>
            <button className="button" onClick={() => void loadMap(false)} disabled={busy || !canAnalyzeSelected}>Iniciar análisis</button>
            <button className="button secondary" onClick={() => void loadMap(true)} disabled={busy || !canAnalyzeSelected}>Regenerar</button>
            {!canAnalyzeSelected && <span className="analysis-error">Este libro no tiene pasajes indexados. Vuelve a ingerirlo primero.</span>}
            {status && <span className="analysis-status">{status}</span>}
            {error && <span className="analysis-error">{error}</span>}
          </aside>

          <main className="analysis-main">
            {busy && <AnalysisLoader status={status} tab={tab} />}
            <nav className="tabs">
              {(['map', 'timeline', 'characters', 'chapters', 'profile'] as Tab[]).map((item) => (
                <button className={tab === item ? 'active' : ''} onClick={() => setTab(item)} key={item}>{tabLabel(item)}</button>
              ))}
            </nav>

            {tab === 'map' && (
              <div className="analysis-card">
                <h2>Relaciones</h2>
                {!relationships.length && <p className="muted">Ejecuta el análisis para construir el mapa de relaciones.</p>}
                {characters.length > 0 && (
                  <CharacterGraph
                    characters={characters}
                    relationships={relationships}
                    onCharacterClick={(name) => void loadProfile(name)}
                  />
                )}
              </div>
            )}

            {tab === 'timeline' && (
              <div className="analysis-card">
                <StoryTimeline
                  events={events}
                  characters={characters}
                  onCharacterClick={(name) => void loadProfile(name)}
                />
              </div>
            )}

            {tab === 'characters' && (
              <div className="analysis-card">
                <CharacterAtlas
                  characters={characters}
                  relationships={relationships}
                  onOpenProfile={(name) => void loadProfile(name)}
                />
              </div>
            )}

            {tab === 'chapters' && (
              <div className="analysis-card chapter-layout">
                <div className="chapter-list">
                  {chapters.map((chapter) => (
                    <button
                      className={selectedChapter?.num === chapter.num ? 'active' : ''}
                      onClick={() => void loadSummary(chapter)}
                      key={chapter.num}
                    >
                      <strong>Cap. {chapter.num + 1}</strong>
                      <span>{chapter.title}</span>
                      {chapter.cached && <em>en caché</em>}
                    </button>
                  ))}
                </div>
                <ChapterSummary chapter={selectedChapter} content={summary} loading={busy && tab === 'chapters'} />
              </div>
            )}

            {tab === 'profile' && (
              <div className="analysis-card">
                <div className="profile-toolbar">
                  <h2>{selectedCharacter || 'Perfil de personaje'}</h2>
                  {selectedCharacter && <button className="button secondary compact" onClick={() => void loadProfile(selectedCharacter, true)} disabled={busy}>Regenerar</button>}
                </div>
                <CharacterSheet
                  name={selectedCharacter}
                  content={profile}
                  character={selectedCharacterData}
                  loading={busy}
                />
              </div>
            )}
          </main>
        </section>
      )}
    </div>
  );
}

function AnalysisLoader({ status, tab }: { status: string; tab: Tab }) {
  const steps = loaderSteps(tab, status);
  return (
    <div className="analysis-loader" role="status" aria-live="polite">
      <div className="loader-orbit">
        <span className="orbit-ring ring-one" />
        <span className="orbit-ring ring-two" />
        <span className="orbit-core" />
        <span className="orbit-dot dot-one" />
        <span className="orbit-dot dot-two" />
      </div>
      <div className="loader-copy">
        <span className="eyebrow">Análisis en curso</span>
        <h2>{loaderTitle(tab)}</h2>
        <p>{status || 'Preparando contexto literario...'}</p>
        <div className="loader-steps">
          {steps.map((step) => (
            <span className={step.active ? 'active' : ''} key={step.label}>
              {step.label}
            </span>
          ))}
        </div>
      </div>
      <div className="loader-scan">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

type CharacterFilter = 'all' | 'protagonist' | 'antagonist' | 'supporting' | 'minor';

type CharacterInsight = {
  character: Character;
  connections: Relationship[];
  score: number;
  presence: 'Central' | 'Recurrente' | 'Satélite';
};

function CharacterAtlas({
  characters,
  relationships,
  onOpenProfile,
}: {
  characters: Character[];
  relationships: Relationship[];
  onOpenProfile: (name: string) => void;
}) {
  const [filter, setFilter] = useState<CharacterFilter>('all');
  const [query, setQuery] = useState('');
  const insights = useMemo(() => buildCharacterInsights(characters, relationships), [characters, relationships]);
  const featured = insights.slice(0, 4);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = insights.filter(({ character }) => {
    const role = character.role || 'supporting';
    const matchesRole = filter === 'all' || role === filter;
    const matchesQuery = !normalizedQuery
      || character.name.toLowerCase().includes(normalizedQuery)
      || (character.description || '').toLowerCase().includes(normalizedQuery);
    return matchesRole && matchesQuery;
  });

  if (!characters.length) {
    return (
      <div className="character-atlas empty-atlas">
        <div className="chapter-summary-empty">
          <span>🎭</span>
          <h3>No hay personajes todavía</h3>
          <p>Ejecuta el análisis para construir el atlas de personajes del libro.</p>
        </div>
      </div>
    );
  }

  return (
    <section className="character-atlas">
      <header className="atlas-hero">
        <div>
          <span className="micro-label">Atlas de personajes</span>
          <h2>Personajes</h2>
          <p>Explora el reparto por relevancia narrativa, rol y vínculos principales.</p>
        </div>
        <div className="atlas-search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar personaje..."
            aria-label="Buscar personaje"
          />
        </div>
      </header>

      <div className="atlas-filters" aria-label="Filtrar personajes por rol">
        {(['all', 'protagonist', 'antagonist', 'supporting', 'minor'] as CharacterFilter[]).map((item) => (
          <button className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} key={item}>
            {roleFilterLabel(item)}
            <span>{countByRole(characters, item)}</span>
          </button>
        ))}
      </div>

      {featured.length > 0 && (
        <section className="atlas-featured" aria-label="Personajes destacados">
          {featured.map((item) => (
            <button
              className={`featured-character ${item.character.role || 'supporting'}`}
              onClick={() => onOpenProfile(item.character.name)}
              key={item.character.id}
            >
              <div className="featured-avatar">{initials(item.character.name)}</div>
              <div>
                <span>{item.presence}</span>
                <h3>{item.character.name}</h3>
                <p>{item.character.description || 'Personaje detectado en el análisis.'}</p>
              </div>
            </button>
          ))}
        </section>
      )}

      <div className="atlas-section-head">
        <div>
          <h3>{filter === 'all' ? 'Reparto completo' : roleFilterLabel(filter)}</h3>
          <p>{visible.length} personaje{visible.length === 1 ? '' : 's'} en esta vista</p>
        </div>
      </div>

      <div className="character-grid atlas-grid">
        {visible.map((item) => (
          <button className={`character-card atlas-card ${item.character.role || 'supporting'}`} onClick={() => onOpenProfile(item.character.name)} key={item.character.id}>
            <div className="atlas-card-head">
              <div className="mini-avatar">{initials(item.character.name)}</div>
              <div>
                <strong>{item.character.name}</strong>
                <span>{translateRole(item.character.role || 'character')}</span>
              </div>
            </div>
            <p>{item.character.description || 'Sin descripción breve.'}</p>
            <div className="atlas-meta">
              <span>{item.presence}</span>
              <span>{connectionLabel(item.connections.length)}</span>
            </div>
            {item.connections.length > 0 && (
              <div className="relation-chips">
                {item.connections.slice(0, 3).map((relationship) => (
                  <span key={`${relationship.from}-${relationship.to}-${relationship.label || relationship.type}`}>
                    {relationship.label || relationship.type || relatedName(relationship, item.character, characters)}
                  </span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

function buildCharacterInsights(characters: Character[], relationships: Relationship[]): CharacterInsight[] {
  const roleWeight: Record<string, number> = {
    protagonist: 40,
    antagonist: 34,
    supporting: 18,
    minor: 8,
  };

  return characters
    .map((character) => {
      const connections = relationships.filter((relationship) => touchesCharacter(relationship, character));
      const score = (roleWeight[character.role || 'supporting'] || 12)
        + connections.length * 6
        + connections.reduce((total, relationship) => total + (relationship.strength || 1), 0);
      return {
        character,
        connections,
        score,
        presence: presenceLabel(score, connections.length),
      };
    })
    .sort((a, b) => b.score - a.score || a.character.name.localeCompare(b.character.name));
}

function touchesCharacter(relationship: Relationship, character: Character) {
  return relationship.from === character.id
    || relationship.to === character.id
    || relationship.from === character.name
    || relationship.to === character.name;
}

function relatedName(relationship: Relationship, character: Character, characters: Character[]) {
  const relatedId = relationship.from === character.id || relationship.from === character.name ? relationship.to : relationship.from;
  return characters.find((candidate) => candidate.id === relatedId || candidate.name === relatedId)?.name || relatedId;
}

function presenceLabel(score: number, connectionCount: number): CharacterInsight['presence'] {
  if (score >= 48 || connectionCount >= 5) return 'Central';
  if (score >= 24 || connectionCount >= 2) return 'Recurrente';
  return 'Satélite';
}

function connectionLabel(count: number) {
  if (!count) return 'Sin vínculos detectados';
  if (count === 1) return '1 vínculo';
  return `${count} vínculos`;
}

function countByRole(characters: Character[], filter: CharacterFilter) {
  if (filter === 'all') return characters.length;
  return characters.filter((character) => (character.role || 'supporting') === filter).length;
}

function roleFilterLabel(filter: CharacterFilter) {
  const labels: Record<CharacterFilter, string> = {
    all: 'Todos',
    protagonist: 'Protagonistas',
    antagonist: 'Antagonistas',
    supporting: 'Secundarios',
    minor: 'Menores',
  };
  return labels[filter];
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

type SummarySection = {
  title: string;
  body: string;
  kind: 'overview' | 'events' | 'themes' | 'characters' | 'quotes' | 'default';
};

function ChapterSummary({ chapter, content, loading }: { chapter: Chapter | null; content: string; loading: boolean }) {
  const sections = parseSummarySections(content);
  const intro = extractIntro(content);

  if (!chapter && !content) {
    return (
      <section className="chapter-summary empty-summary">
        <div className="chapter-summary-empty">
          <span>📖</span>
          <h3>Elige un capítulo</h3>
          <p>Genera un resumen estructurado con eventos, temas y señales narrativas.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="chapter-summary">
      <header className="chapter-summary-hero">
        <div className="chapter-badge">Cap. {chapter ? chapter.num + 1 : '...'}</div>
        <div>
          <span className="micro-label">Resumen narrativo</span>
          <h2>{chapter?.title || 'Capítulo en análisis'}</h2>
          {intro && <p>{cleanMarkdown(intro)}</p>}
        </div>
      </header>

      {loading && !content && (
        <div className="chapter-summary-empty compact">
          <span className="status-dot small" />
          <p>Construyendo resumen del capítulo...</p>
        </div>
      )}

      {sections.length > 0 && (
        <div className="chapter-summary-grid">
          {sections.map((section) => (
            <article className={`summary-section ${section.kind}`} key={section.title}>
              <div className="summary-section-heading">
                <span>{summaryIcon(section.kind)}</span>
                <div>
                  <h3>{translateSummaryTitle(section.title)}</h3>
                  <p>{summaryHint(section.kind)}</p>
                </div>
              </div>
              <SummaryBody section={section} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryBody({ section }: { section: SummarySection }) {
  const blocks = section.body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <div className="summary-body">
      {blocks.map((block, index) => {
        if (/^\d+\.\s*/m.test(block)) {
          return (
            <ol className={section.kind === 'events' ? 'event-list' : undefined} key={index}>
              {block.split('\n').filter(Boolean).map((line) => {
                const item = line.replace(/^\d+\.\s*/, '').trim();
                const [label, ...rest] = item.split(':');
                const hasLabel = rest.length > 0 && label.length < 90;
                return (
                  <li key={line}>
                    {hasLabel ? (
                      <>
                        <strong>{stripMarkdown(label)}</strong>
                        <span>{renderInline(rest.join(':').trim())}</span>
                      </>
                    ) : renderInline(item)}
                  </li>
                );
              })}
            </ol>
          );
        }

        if (/^[-*]\s/m.test(block)) {
          return (
            <ul key={index}>
              {block.split('\n').filter(Boolean).map((line) => (
                <li key={line}>{renderInline(line.replace(/^[-*]\s*/, ''))}</li>
              ))}
            </ul>
          );
        }

        if (block.startsWith('>')) {
          return <blockquote key={index}>{renderInline(block.replace(/^>\s?/, ''))}</blockquote>;
        }

        return <p key={index}>{renderInline(block)}</p>;
      })}
    </div>
  );
}

function parseSummarySections(markdown: string): SummarySection[] {
  const parts = markdown.split(/^##\s+/gm).map((part) => part.trim()).filter(Boolean);
  return parts
    .filter((part) => part.includes('\n'))
    .map((part) => {
      const [rawTitle, ...body] = part.split('\n');
      const title = rawTitle.replace(/^#+\s*/, '').trim();
      return {
        title,
        body: body.join('\n').trim(),
        kind: summaryKind(title),
      };
    });
}

function extractIntro(markdown: string) {
  const [first] = markdown.split(/^##\s+/gm);
  return first?.trim() || '';
}

function summaryKind(title: string): SummarySection['kind'] {
  const lower = title.toLowerCase();
  if (/overview|resumen|síntesis|sintesis/.test(lower)) return 'overview';
  if (/event|suceso|acontecimiento|momento|clave/.test(lower)) return 'events';
  if (/theme|tema|motif|motivo|symbol|símbolo|simbolo/.test(lower)) return 'themes';
  if (/character|personaje/.test(lower)) return 'characters';
  if (/quote|cita/.test(lower)) return 'quotes';
  return 'default';
}

function translateSummaryTitle(title: string) {
  const titles: Record<string, string> = {
    Overview: 'Panorama',
    'Key Events': 'Eventos clave',
    Themes: 'Temas',
    Characters: 'Personajes',
    'Character Notes': 'Notas de personajes',
    'Notable Quotes': 'Citas destacadas',
  };
  return titles[title] || title;
}

function summaryIcon(kind: SummarySection['kind']) {
  const icons: Record<SummarySection['kind'], string> = {
    overview: '🧭',
    events: '⚡',
    themes: '🧩',
    characters: '🎭',
    quotes: '❝',
    default: '✦',
  };
  return icons[kind];
}

function summaryHint(kind: SummarySection['kind']) {
  const hints: Record<SummarySection['kind'], string> = {
    overview: 'Qué cambia y por qué importa dentro del libro.',
    events: 'Puntos de giro, escenas importantes y consecuencias.',
    themes: 'Ideas, símbolos y tensiones que aparecen en el capítulo.',
    characters: 'Quiénes aparecen y qué revela el capítulo sobre ellos.',
    quotes: 'Frases o evidencias textuales que sostienen la lectura.',
    default: 'Lectura estructurada del capítulo.',
  };
  return hints[kind];
}

function renderInline(text: string): ReactNode[] {
  return cleanMarkdown(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function cleanMarkdown(text: string) {
  return text.replace(/\n/g, ' ').trim();
}

function stripMarkdown(text: string) {
  return cleanMarkdown(text).replace(/\*\*/g, '');
}

function loaderTitle(tab: Tab) {
  if (tab === 'profile') return 'Forjando la ficha del personaje';
  if (tab === 'chapters') return 'Destilando el arco del capítulo';
  if (tab === 'timeline') return 'Trazando el pulso narrativo';
  return 'Mapeando la red de la historia';
}

function loaderSteps(tab: Tab, status: string) {
  const lower = status.toLowerCase();
  const labels = tab === 'profile'
    ? ['Recuperar escenas', 'Leer motivaciones', 'Dar forma a la ficha']
    : tab === 'chapters'
      ? ['Leer capítulo', 'Extraer eventos', 'Escribir resumen']
      : ['Recuperar pasajes', 'Encontrar elenco', 'Dibujar arco'];
  return labels.map((label, index) => ({
    label,
    active:
      index === 0 ||
      (index === 1 && /(identifying|expanding|analyzing|building|summarizing|waiting)/.test(lower)) ||
      (index === 2 && /(analyzing|building|summarizing|waiting|complete)/.test(lower)),
  }));
}

function tabLabel(tab: Tab) {
  const labels: Record<Tab, string> = {
    map: 'Mapa',
    timeline: 'Línea de tiempo',
    characters: 'Personajes',
    chapters: 'Capítulos',
    profile: 'Perfil',
  };
  return labels[tab];
}

function translateRole(role: string) {
  const roles: Record<string, string> = {
    protagonist: 'protagonista',
    antagonist: 'antagonista',
    supporting: 'secundario',
    minor: 'menor',
    character: 'personaje',
  };
  return roles[role] || role;
}

function translateTaskStatus(message: string) {
  return message
    .replace('Retrieving character passages…', 'Recuperando pasajes de personajes...')
    .replace('Identifying characters…', 'Identificando personajes...')
    .replace(/^Expanding context for (\d+) characters…$/, 'Ampliando contexto para $1 personajes...')
    .replace(/^Analyzing (\d+) passages…/, 'Analizando $1 pasajes...')
    .replace(/^Finding passages about (.+)…$/, 'Buscando pasajes sobre $1...')
    .replace(/^Building profile for (.+)…$/, 'Construyendo perfil de $1...')
    .replace(/^Reading (\d+) sections…$/, 'Leyendo $1 secciones...')
    .replace('Summarizing chapter…', 'Resumiendo capítulo...')
    .replace(/^Waiting for (.+) to respond…$/, 'Esperando respuesta de $1...');
}
