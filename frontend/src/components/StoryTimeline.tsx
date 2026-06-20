import type { Character, StoryEvent } from '../types';

type Props = {
  events: StoryEvent[];
  characters: Character[];
  onCharacterClick: (name: string) => void;
};

const eventMeta: Record<string, { icon: string; label: string }> = {
  battle: { icon: '⚔️', label: 'Batalla' },
  death: { icon: '💀', label: 'Muerte' },
  romance: { icon: '❤️', label: 'Romance' },
  betrayal: { icon: '🗡️', label: 'Traición' },
  discovery: { icon: '🔍', label: 'Descubrimiento' },
  meeting: { icon: '🤝', label: 'Encuentro' },
  journey: { icon: '🚶', label: 'Viaje' },
  ceremony: { icon: '🎭', label: 'Ceremonia' },
  political: { icon: '👑', label: 'Político' },
  transformation: { icon: '🦋', label: 'Transformación' },
  conflict: { icon: '💥', label: 'Conflicto' },
  other: { icon: '📖', label: 'Evento' },
};

export function StoryTimeline({ events, characters, onCharacterClick }: Props) {
  if (!events.length) {
    return <p className="muted">Ejecuta el análisis para extraer la línea de tiempo del libro.</p>;
  }

  const mainEvents = events.filter((event) => !event.is_epilogue);
  const epilogueEvents = events.filter((event) => event.is_epilogue);
  const climaxIndex = events.findIndex((event) => event.is_climax);
  const resolutionIndex = events.findIndex((event) => event.is_resolution);
  const characterById = new Map(characters.map((char) => [char.id, char]));

  return (
    <div className="story-experience">
      <section className="timeline-hero">
        <div>
          <span className="eyebrow">Arco narrativo</span>
          <h2>{events.length} eventos clave</h2>
          <p>
            Sigue el libro desde el planteamiento hasta la escalada, el clímax, la resolución y el epílogo.
          </p>
        </div>
        <div className="arc-metrics">
          <Metric label="Clímax" value={climaxIndex >= 0 ? `Evento ${climaxIndex + 1}` : 'Falta'} />
          <Metric label="Resolución" value={resolutionIndex >= 0 ? `Evento ${resolutionIndex + 1}` : 'Falta'} />
          <Metric label="Epílogo" value={epilogueEvents.length ? `${epilogueEvents.length} eventos` : 'Ninguno'} />
        </div>
      </section>

      <div className="timeline-layout">
        <aside className="timeline-index">
          <h3>Arco</h3>
          {events.map((event, index) => (
            <a href={`#story-beat-${index}`} key={`${event.title}-${index}`} className={event.is_climax || event.is_resolution ? 'major' : ''}>
              <span>{index + 1}</span>
              {event.title}
            </a>
          ))}
        </aside>

        <section className="story-rail">
          {mainEvents.map((event, index) => (
            <TimelineCard
              event={event}
              index={index}
              key={`${event.title}-${index}`}
              characterById={characterById}
              onCharacterClick={onCharacterClick}
            />
          ))}

          {epilogueEvents.length > 0 && (
            <div className="fin-divider">
              <span>🏁</span>
              <strong>FIN</strong>
            </div>
          )}

          {epilogueEvents.map((event, epiIndex) => (
            <TimelineCard
              event={event}
              index={mainEvents.length + epiIndex}
              key={`${event.title}-epilogue-${epiIndex}`}
              characterById={characterById}
              onCharacterClick={onCharacterClick}
            />
          ))}
        </section>
      </div>
    </div>
  );
}

function TimelineCard({
  event,
  index,
  characterById,
  onCharacterClick,
}: {
  event: StoryEvent;
  index: number;
  characterById: Map<string, Character>;
  onCharacterClick: (name: string) => void;
}) {
  const meta = eventMeta[event.type || 'other'] || eventMeta.other;
  const tone = event.is_climax ? 'climax' : event.is_resolution ? 'resolution' : event.is_epilogue ? 'epilogue' : event.type || 'other';

  return (
    <article className={`story-card ${tone}`} id={`story-beat-${index}`}>
      <div className="story-marker">
        <span>{meta.icon}</span>
      </div>
      <div className="story-card-body">
        <div className="story-card-head">
          <span className="beat-number">Evento {index + 1}</span>
          <span className="event-type">{event.is_climax ? 'Clímax' : event.is_resolution ? 'Resolución' : meta.label}</span>
        </div>
        <h3>{event.title}</h3>
        <p>{event.description}</p>
        {event.characters?.length ? (
          <div className="event-characters">
            {event.characters.map((id) => {
              const character = characterById.get(id);
              const label = character?.name || id;
              return (
                <button type="button" key={id} onClick={() => character && onCharacterClick(character.name)}>
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
