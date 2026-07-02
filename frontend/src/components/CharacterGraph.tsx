import cytoscape, { Core, EventObject } from 'cytoscape';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Character, Relationship } from '../types';

type Props = {
  characters: Character[];
  relationships: Relationship[];
  onCharacterClick: (name: string) => void;
};

type RelatedRow = {
  relationship: Relationship;
  counterpart: Character | null;
  counterpartLabel: string;
  direction: 'outgoing' | 'incoming' | 'undirected';
  evidence: string;
};

const roleLabels: Record<string, string> = {
  protagonist: 'Protagonista',
  antagonist: 'Antagonista',
  supporting: 'Secundario',
  minor: 'Menor',
};

export function CharacterGraph({ characters, relationships, onCharacterClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [relationshipFilter, setRelationshipFilter] = useState('all');

  const characterById = useMemo(() => new Map(characters.map((char) => [char.id, char])), [characters]);
  const preferredId = useMemo(() => pickDefaultCharacterId(characters, relationships), [characters, relationships]);
  const selectedCharacter = selectedId ? characterById.get(selectedId) || null : null;
  const relatedRows = useMemo(
    () => buildRelatedRows(selectedCharacter, characters, relationships),
    [selectedCharacter, characters, relationships],
  );
  const graphCharacters = useMemo(() => {
    if (!selectedCharacter) return characters.slice(0, 12);
    const ids = new Set<string>([selectedCharacter.id]);
    for (const row of relatedRows) {
      const source = row.relationship.from;
      const target = row.relationship.to;
      if (characterById.has(source)) ids.add(source);
      if (characterById.has(target)) ids.add(target);
      if (row.counterpart) ids.add(row.counterpart.id);
    }
    const nodes = characters.filter((char) => ids.has(char.id));
    return prioritizeNeighborhood(selectedCharacter, nodes, relationships);
  }, [selectedCharacter, relatedRows, characters, relationships, characterById]);
  const graphRelationships = useMemo(() => {
    const ids = new Set(graphCharacters.map((char) => char.id));
    return relationships.filter((rel) => ids.has(rel.from) && ids.has(rel.to) && rel.from !== rel.to);
  }, [graphCharacters, relationships]);
  const relationshipTypes = useMemo(() => {
    const types = new Set(relationships.map((rel) => rel.type || 'neutral'));
    return ['all', ...Array.from(types).sort()];
  }, [relationships]);
  const selectedStats = useMemo(() => {
    const outgoing = relatedRows.filter((row) => row.direction === 'outgoing').length;
    const incoming = relatedRows.filter((row) => row.direction === 'incoming').length;
    const aliases = selectedCharacter?.aliases || [];
    return { outgoing, incoming, aliases };
  }, [relatedRows, selectedCharacter]);

  useEffect(() => {
    const nextId = selectedId && characterById.has(selectedId) ? selectedId : preferredId;
    if (nextId !== selectedId) setSelectedId(nextId || null);
  }, [preferredId, selectedId, characterById]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!graphCharacters.length) return;

    const validIds = new Set(graphCharacters.map((char) => char.id));
    const elements: cytoscape.ElementDefinition[] = [
      ...graphCharacters.map((char) => ({
        data: {
          id: char.id,
          label: char.name,
          role: char.role || 'supporting',
          description: char.description || '',
          size: char.id === selectedCharacter?.id ? 86 : char.role === 'protagonist' ? 70 : char.role === 'antagonist' ? 62 : char.role === 'minor' ? 44 : 54,
          focus: char.id === selectedCharacter?.id ? 1 : 0,
        },
        classes: char.role || 'supporting',
      })),
      ...graphRelationships
        .filter((rel) => validIds.has(rel.from) && validIds.has(rel.to))
        .map((rel, index) => ({
          data: {
            id: `${rel.from}-${rel.to}-${index}`,
            source: rel.from,
            target: rel.to,
            label: rel.label || translateRelationshipType(rel.type || 'neutral'),
            type: rel.type || 'neutral',
            strength: rel.strength || 1,
          },
          classes: rel.type || 'neutral',
        })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.55,
      maxZoom: 2.2,
      wheelSensitivity: 0.18,
      style: [
        {
          selector: 'node',
          style: {
            width: 'data(size)',
            height: 'data(size)',
            label: 'data(label)',
            color: '#f8fafc',
            'font-size': 13,
            'font-weight': 850,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '104px',
            'background-color': '#0f766e',
            'border-color': 'rgba(255,255,255,0.24)',
            'border-width': 2,
            'text-outline-color': '#07101d',
            'text-outline-width': 3,
          },
        },
        { selector: 'node.protagonist', style: { 'background-color': '#7c3aed', width: 88, height: 88 } },
        { selector: 'node.antagonist', style: { 'background-color': '#dc2626', width: 68, height: 68 } },
        { selector: 'node.supporting', style: { 'background-color': '#0f766e' } },
        { selector: 'node.minor', style: { 'background-color': '#1e293b', color: '#cbd5e1' } },
        { selector: 'node[focus = 1]', style: { 'border-color': '#f8fafc', 'border-width': 4, 'overlay-opacity': 0.08 } },
        {
          selector: 'edge',
          style: {
            width: 'mapData(strength, 1, 6, 1.8, 5.4)',
            'curve-style': 'bezier',
            'target-arrow-shape': 'none',
            'line-color': '#64748b',
            opacity: 0.68,
            label: 'data(label)',
            color: '#cbd5e1',
            'font-size': 10,
            'text-background-color': '#070a12',
            'text-background-opacity': 0.86,
            'text-background-padding': '3px',
          },
        },
        { selector: 'edge.family', style: { 'line-color': '#38bdf8' } },
        { selector: 'edge.romantic', style: { 'line-color': '#f472b6' } },
        { selector: 'edge.ally, edge.mentor', style: { 'line-color': '#22c55e' } },
        { selector: 'edge.enemy, edge.rival', style: { 'line-color': '#f87171', 'line-style': 'dashed' } },
        { selector: '.faded', style: { opacity: 0.14 } },
        { selector: '.hidden-rel', style: { display: 'none' } },
        { selector: 'node.selected', style: { 'border-color': '#f8fafc', 'border-width': 5 } },
        { selector: 'edge.selected, edge.hovered', style: { opacity: 1, width: 5 } },
      ],
      layout: {
        name: 'breadthfirst',
        directed: false,
        roots: selectedCharacter?.id ? [selectedCharacter.id] : graphCharacters[0]?.id ? [graphCharacters[0].id] : [],
        spacingFactor: 1.3,
        animate: false,
        fit: true,
        padding: 42,
        circle: false,
      },
    });

    cy.on('tap', 'node', (event: EventObject) => {
      const node = event.target;
      const id = node.id();
      setSelectedId(id);
      onCharacterClick(node.data('label'));
    });

    cy.on('mouseover', 'edge', (event: EventObject) => event.target.addClass('hovered'));
    cy.on('mouseout', 'edge', (event: EventObject) => event.target.removeClass('hovered'));
    cy.on('tap', (event: EventObject) => {
      if (event.target === cy) setSelectedId(null);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graphCharacters, graphRelationships, onCharacterClick, selectedCharacter?.id]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.elements().removeClass('faded selected hidden-rel');
    cy.edges().removeClass('selected');

    if (relationshipFilter !== 'all') {
      cy.edges().not(`[type = "${relationshipFilter}"]`).addClass('hidden-rel');
    }

    if (selectedId) {
      const selected = cy.getElementById(selectedId);
      const neighborhood = selected.closedNeighborhood();
      cy.elements().difference(neighborhood).addClass('faded');
      selected.addClass('selected');
      selected.connectedEdges().addClass('selected');
    }
  }, [selectedId, relationshipFilter]);

  function fitGraph() {
    cyRef.current?.fit(undefined, 40);
  }

  function clearFocus() {
    setSelectedId(selectedCharacter?.id || preferredId || null);
    cyRef.current?.elements().removeClass('faded selected');
  }

  return (
    <div className="relationship-explorer">
      <section className="relationship-header">
        <div>
          <span className="micro-label">Mapa relacional</span>
          <h3>{selectedCharacter?.name || 'Selecciona un personaje'}</h3>
          <p>
            La vista muestra solo el entorno relevante del personaje seleccionado, para que puedas leer vínculos,
            dirección y evidencia sin perderte en una red completa.
          </p>
        </div>
        <div className="relationship-switcher" role="tablist" aria-label="Personajes destacados">
          {selectableCharacters(characters, relationships).slice(0, 8).map((character) => (
            <button
              key={character.id}
              type="button"
              className={selectedCharacter?.id === character.id ? 'active' : ''}
              onClick={() => setSelectedId(character.id)}
            >
              {character.name}
            </button>
          ))}
        </div>
      </section>

      <div className="relationship-shell">
        <aside className="relationship-panel relationship-summary">
          <div className="relationship-summary-head">
            <div className={`mini-avatar ${selectedCharacter?.role || 'supporting'}`}>{initials(selectedCharacter?.name || 'P')}</div>
            <div>
              <h4>{selectedCharacter?.name || 'Sin selección'}</h4>
              <p>{selectedCharacter?.description || 'Elige un personaje para ver su red inmediata.'}</p>
            </div>
          </div>

          <div className="relationship-metrics">
            <Metric label="Salientes" value={String(selectedStats.outgoing)} />
            <Metric label="Entrantes" value={String(selectedStats.incoming)} />
            <Metric label="Aliases" value={String(selectedStats.aliases.length)} />
          </div>

          {selectedStats.aliases.length > 0 && (
            <div className="alias-group">
              <span className="micro-label">Alias detectados</span>
              <div className="alias-chips">
                {selectedStats.aliases.map((alias) => (
                  <span key={alias}>{alias}</span>
                ))}
              </div>
            </div>
          )}

          <div className="graph-toolbar">
            <select value={relationshipFilter} onChange={(event) => setRelationshipFilter(event.target.value)}>
              {relationshipTypes.map((type) => (
                <option value={type} key={type}>
                  {type === 'all' ? 'Todas las relaciones' : translateRelationshipType(type)}
                </option>
              ))}
            </select>
            <button className="button secondary compact" type="button" onClick={fitGraph}>
              Ajustar
            </button>
            <button className="button secondary compact" type="button" onClick={clearFocus}>
              Resetear foco
            </button>
          </div>
        </aside>

        <div className="relationship-main">
          <div className="relationship-table-wrap">
            <div className="relationship-table-head">
              <h4>Relaciones directas</h4>
              <p>{relatedRows.length} vínculo{relatedRows.length === 1 ? '' : 's'} visibles</p>
            </div>
            <div className="relationship-table">
              {relatedRows.length === 0 ? (
                <div className="relationship-empty">No hay vínculos suficientes para este personaje.</div>
              ) : (
                relatedRows.map((row) => (
                  <button
                    key={relationshipKey(row)}
                    type="button"
                    className="relationship-row"
                    onClick={() => row.counterpart && onCharacterClick(row.counterpart.name)}
                  >
                    <div className="relationship-row-main">
                      <strong>{row.counterpartLabel}</strong>
                      <span>{relationshipDirectionLabel(row.direction)}</span>
                    </div>
                    <div className="relationship-row-meta">
                      <span className={`rel-pill ${row.relationship.type || 'neutral'}`}>
                        {translateRelationshipType(row.relationship.type || 'neutral')}
                      </span>
                      <span className="rel-pill subtle">{row.relationship.label || 'Sin etiqueta'}</span>
                      <span className="rel-pill subtle">{connectionWeightLabel(row.relationship.strength || 1)}</span>
                    </div>
                    {row.evidence && <p>{row.evidence}</p>}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="cyto-panel">
            <div className="cyto-canvas relationship-canvas" ref={containerRef} />
            <div className="graph-legend">
              {Object.entries(roleLabels).map(([role, label]) => (
                <span key={role}>
                  <b className={`legend ${role}`} />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildRelatedRows(
  selectedCharacter: Character | null,
  characters: Character[],
  relationships: Relationship[],
): RelatedRow[] {
  if (!selectedCharacter) return [];

  const rows = relationships
    .filter((relationship) => touchesCharacter(relationship, selectedCharacter))
    .map((relationship) => {
      const outgoing = relationship.from === selectedCharacter.id || relationship.from === selectedCharacter.name;
      const counterpartId = outgoing ? relationship.to : relationship.from;
      const counterpart =
        characters.find((candidate) => candidate.id === counterpartId || candidate.name === counterpartId)
        || null;
      const counterpartLabel = counterpart?.name || counterpartId;
      const evidence = relationship.evidence?.[0]?.summary || '';
      const direction: RelatedRow['direction'] = outgoing ? 'outgoing' : 'incoming';
      return {
        relationship,
        counterpart,
        counterpartLabel,
        direction,
        evidence,
      };
    });

  rows.sort((a, b) => {
    const strengthDiff = (b.relationship.strength || 1) - (a.relationship.strength || 1);
    if (strengthDiff) return strengthDiff;
    return relationshipSortRank(b.relationship.type) - relationshipSortRank(a.relationship.type);
  });

  return rows;
}

function prioritizeNeighborhood(selected: Character, nodes: Character[], relationships: Relationship[]) {
  const related = new Map<string, number>();
  for (const rel of relationships) {
    const touches = rel.from === selected.id || rel.to === selected.id;
    if (!touches) continue;
    const otherId = rel.from === selected.id ? rel.to : rel.from;
    related.set(otherId, (related.get(otherId) || 0) + (rel.strength || 1));
  }
  return nodes.sort((a, b) => {
    if (a.id === selected.id) return -1;
    if (b.id === selected.id) return 1;
    const scoreA = related.get(a.id) || 0;
    const scoreB = related.get(b.id) || 0;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return (roleRank(b.role) - roleRank(a.role)) || a.name.localeCompare(b.name);
  });
}

function selectableCharacters(characters: Character[], relationships: Relationship[]) {
  return characters
    .map((character) => ({
      character,
      score: roleRank(character.role) * 10 + relationships.filter((rel) => touchesCharacter(rel, character)).length,
    }))
    .sort((a, b) => b.score - a.score || a.character.name.localeCompare(b.character.name))
    .map(({ character }) => character);
}

function pickDefaultCharacterId(characters: Character[], relationships: Relationship[]) {
  if (!characters.length) return '';
  const selected = selectableCharacters(characters, relationships);
  return selected[0]?.id || characters[0]?.id || '';
}

function roleRank(role?: string) {
  return { protagonist: 4, antagonist: 3, supporting: 2, minor: 1 }[role || 'supporting'] || 1;
}

function touchesCharacter(relationship: Relationship, character: Character) {
  return relationship.from === character.id
    || relationship.to === character.id
    || relationship.from === character.name
    || relationship.to === character.name;
}

function relationshipSortRank(type?: string) {
  return {
    romantic: 7,
    family: 6,
    enemy: 5,
    rival: 4,
    mentor: 3,
    ally: 2,
    neutral: 1,
  }[type || 'neutral'] || 1;
}

function relationshipKey(row: RelatedRow) {
  return `${row.relationship.from}-${row.relationship.to}-${row.relationship.type || 'neutral'}-${row.counterpartLabel}`;
}

function connectionWeightLabel(strength: number) {
  if (strength >= 5) return 'Muy fuerte';
  if (strength >= 3) return 'Fuerte';
  if (strength >= 2) return 'Recurrente';
  return 'Aparición';
}

function relationshipDirectionLabel(direction: RelatedRow['direction']) {
  if (direction === 'incoming') return 'hacia el personaje';
  if (direction === 'outgoing') return 'desde el personaje';
  return 'bidireccional';
}

function translateRelationshipType(type: string) {
  const labels: Record<string, string> = {
    family: 'familia',
    ally: 'aliado',
    enemy: 'enemigo',
    romantic: 'romántica',
    mentor: 'mentor',
    rival: 'rival',
    neutral: 'neutral',
  };
  return labels[type] || type;
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
