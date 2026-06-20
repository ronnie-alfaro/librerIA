import type { Character } from '../types';

type Props = {
  name: string;
  content: string;
  character?: Character;
  loading?: boolean;
};

type ProfileSection = {
  title: string;
  body: string;
};

const sectionMeta: Record<string, { icon: string; hint: string; tone: string }> = {
  Perfil: { icon: '🧭', hint: 'Lectura general del personaje', tone: 'profile' },
  Identidad: { icon: '🪪', hint: 'Quién es y cómo se define dentro de la historia', tone: 'identity' },
  'Personalidad y motivación': { icon: '🧠', hint: 'Deseos, impulsos, temores y contradicciones', tone: 'mind' },
  Trasfondo: { icon: '🏛️', hint: 'Origen, historia previa y contexto social', tone: 'background' },
  Relaciones: { icon: '🕸️', hint: 'Vínculos, lealtades, tensiones y dependencias', tone: 'relationships' },
  'Arco del personaje': { icon: '🌀', hint: 'Transformación narrativa a lo largo del libro', tone: 'arc' },
  'Momentos clave': { icon: '✨', hint: 'Escenas que revelan o cambian al personaje', tone: 'moments' },
  'Citas destacadas': { icon: '❝', hint: 'Frases o evidencias textuales relevantes', tone: 'quotes' },
};

export function CharacterSheet({ name, content, character, loading }: Props) {
  const sections = parseSections(content);
  const summary = character?.description || getFirstParagraph(sections) || 'Los detalles del perfil aparecerán aquí.';
  const traits = buildTraits(sections, character);

  return (
    <article className="character-sheet">
      <header className="sheet-hero">
        <div className={`sheet-avatar ${character?.role || 'supporting'}`}>{initials(name)}</div>
        <div>
          <span className="sheet-kicker">Ficha de {translateRole(character?.role || 'personaje')}</span>
          <h2>{name || 'Perfil de personaje'}</h2>
          <p>{summary}</p>
        </div>
      </header>

      <section className="sheet-traits">
        {traits.map(([label, value]) => (
          <div className="sheet-trait" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      {loading && !content && (
        <div className="sheet-placeholder">
          <span className="status-dot small" />
          Construyendo ficha del personaje...
        </div>
      )}

      {!loading && !content && (
        <div className="sheet-placeholder">Abre un personaje desde la pestaña Personajes o haz clic en un nodo del mapa.</div>
      )}

      {sections.length > 0 && (
        <div className="sheet-sections">
          {sections.map((section) => (
            <section className={`sheet-section ${sectionMeta[section.title]?.tone || 'profile'}`} key={section.title}>
              <div className="sheet-section-title">
                <span className="sheet-section-icon">{sectionMeta[section.title]?.icon || '✦'}</span>
                <div>
                  <h3>{section.title}</h3>
                  <p>{sectionMeta[section.title]?.hint || 'Detalle del perfil literario'}</p>
                </div>
              </div>
              <RichProfileText text={section.body} />
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function parseSections(markdown: string): ProfileSection[] {
  if (!markdown.trim()) return [];
  const parts = markdown.split(/^##\s+/gm).map((part) => part.trim()).filter(Boolean);

  if (!parts.length) {
    return [{ title: 'Perfil', body: markdown }];
  }

  return parts.map((part) => {
    const [title, ...body] = part.split('\n');
    return {
      title: translateSectionTitle(title.replace(/^#+\s*/, '').trim()),
      body: body.join('\n').trim(),
    };
  });
}

function RichProfileText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <div className="sheet-copy">
      {blocks.map((block, index) => {
        if (block.startsWith('>')) {
          return <blockquote key={index}>{cleanInline(block.replace(/^>\s?/, ''))}</blockquote>;
        }
        if (/^\d+\.\s/m.test(block)) {
          return (
            <ol key={index}>
              {block.split('\n').filter(Boolean).map((line) => (
                <li key={line}>{cleanInline(line.replace(/^\d+\.\s*/, ''))}</li>
              ))}
            </ol>
          );
        }
        if (/^[-*]\s/m.test(block)) {
          return (
            <ul key={index}>
              {block.split('\n').filter(Boolean).map((line) => (
                <li key={line}>{cleanInline(line.replace(/^[-*]\s*/, ''))}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{cleanInline(block)}</p>;
      })}
    </div>
  );
}

function cleanInline(text: string) {
  return text.replace(/\*\*/g, '').replace(/\n/g, ' ');
}

function getFirstParagraph(sections: ProfileSection[]) {
  return sections[0]?.body.split(/\n{2,}/)[0]?.replace(/\*\*/g, '').trim();
}

function buildTraits(sections: ProfileSection[], character?: Character): [string, string][] {
  const byTitle = new Map(sections.map((section) => [section.title, section.body]));
  return [
    ['Rol', translateRole(character?.role || 'personaje')],
    ['Arquetipo', inferArchetype(byTitle)],
    ['Motivación', inferCoreDrive(byTitle.get('Personalidad y motivación') || '')],
    ['Tensión', inferTension(byTitle.get('Arco del personaje') || byTitle.get('Trasfondo') || '')],
  ];
}

function inferArchetype(sections: Map<string, string>) {
  const text = Array.from(sections.values()).join(' ').toLowerCase();
  if (/(clairvoy|telepat|esp[ií]ritu|sobrenatural|mystic|vision)/i.test(text)) return 'Mística';
  if (/(poder|control|autoridad|patriarca|ruler|leader)/i.test(text)) return 'Figura de poder';
  if (/(rebel|rebeld|resist|defy|desaf)/i.test(text)) return 'Rebelde';
  if (/(madre|mother|famil|protect|protege|cuid)/i.test(text)) return 'Protectora';
  if (/(mentor|guide|maestr|teacher)/i.test(text)) return 'Mentor';
  return 'Catalizador';
}

function inferCoreDrive(text: string) {
  const lower = text.toLowerCase();
  if (/(famil|hijo|madre|mother|child|protect|protege)/i.test(lower)) return 'Proteger a la familia';
  if (/(libertad|freedom|escape|independ)/i.test(lower)) return 'Buscar libertad';
  if (/(poder|control|ambici|power)/i.test(lower)) return 'Ganar control';
  if (/(amor|love|romance|belong)/i.test(lower)) return 'Encontrar pertenencia';
  if (/(verdad|truth|understand|comprend)/i.test(lower)) return 'Comprender la verdad';
  return 'Preservar identidad';
}

function inferTension(text: string) {
  const lower = text.toLowerCase();
  if (/(silencio|mute|secreto|secret)/i.test(lower)) return 'Silencio vs expresión';
  if (/(famil|family).*(poder|power|control)|(?:poder|power|control).*(famil|family)/i.test(lower)) return 'Familia vs poder';
  if (/(tradici|society|social|convention)/i.test(lower)) return 'Individuo vs sociedad';
  if (/(muerte|death|loss|duelo|grief)/i.test(lower)) return 'Pérdida vs sentido';
  return 'Deseo vs deber';
}

function translateSectionTitle(title: string) {
  const titles: Record<string, string> = {
    Identity: 'Identidad',
    'Personality & Motivation': 'Personalidad y motivación',
    Background: 'Trasfondo',
    Relationships: 'Relaciones',
    'Character Arc': 'Arco del personaje',
    'Key Moments': 'Momentos clave',
    'Notable Quotes': 'Citas destacadas',
  };
  return titles[title] || title;
}

function translateRole(role: string) {
  const roles: Record<string, string> = {
    protagonist: 'protagonista',
    antagonist: 'antagonista',
    supporting: 'secundario',
    minor: 'menor',
    character: 'personaje',
    personaje: 'personaje',
  };
  return roles[role] || role;
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}
