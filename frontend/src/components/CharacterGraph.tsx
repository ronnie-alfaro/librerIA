import cytoscape, { Core, EventObject } from 'cytoscape';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Character, Relationship } from '../types';

type Props = {
  characters: Character[];
  relationships: Relationship[];
  onCharacterClick: (name: string) => void;
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

  const relationshipTypes = useMemo(() => {
    const types = new Set(relationships.map((rel) => rel.type || 'neutral'));
    return ['all', ...Array.from(types).sort()];
  }, [relationships]);

  useEffect(() => {
    if (!containerRef.current) return;

    const validIds = new Set(characters.map((char) => char.id));
    const elements: cytoscape.ElementDefinition[] = [
      ...characters.map((char) => ({
        data: {
          id: char.id,
          label: char.name,
          role: char.role || 'supporting',
          description: char.description || '',
          size: char.role === 'protagonist' ? 72 : char.role === 'antagonist' ? 62 : char.role === 'minor' ? 44 : 54,
        },
        classes: char.role || 'supporting',
      })),
      ...relationships
        .filter((rel) => validIds.has(rel.from) && validIds.has(rel.to) && rel.from !== rel.to)
        .map((rel, index) => ({
          data: {
            id: `${rel.from}-${rel.to}-${index}`,
            source: rel.from,
            target: rel.to,
            label: rel.label || translateRelationshipType(rel.type || 'neutral'),
            type: rel.type || 'neutral',
          },
          classes: rel.type || 'neutral',
        })),
    ];

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.35,
      maxZoom: 2.4,
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
            'font-weight': 800,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '92px',
            'background-color': '#0891b2',
            'border-color': 'rgba(255,255,255,0.24)',
            'border-width': 2,
            'text-outline-color': '#07101d',
            'text-outline-width': 3,
          },
        },
        { selector: 'node.protagonist', style: { 'background-color': '#7c3aed', width: 82, height: 82 } },
        { selector: 'node.antagonist', style: { 'background-color': '#dc2626', width: 68, height: 68 } },
        { selector: 'node.supporting', style: { 'background-color': '#0891b2' } },
        { selector: 'node.minor', style: { 'background-color': '#1e293b', color: '#cbd5e1' } },
        {
          selector: 'edge',
          style: {
            width: 2,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#64748b',
            'line-color': '#64748b',
            opacity: 0.55,
            label: '',
            color: '#cbd5e1',
            'font-size': 10,
            'text-background-color': '#070a12',
            'text-background-opacity': 0.86,
            'text-background-padding': '3px',
          },
        },
        { selector: 'edge.family', style: { 'line-color': '#38bdf8', 'target-arrow-color': '#38bdf8' } },
        { selector: 'edge.romantic', style: { 'line-color': '#f472b6', 'target-arrow-color': '#f472b6' } },
        { selector: 'edge.ally, edge.mentor', style: { 'line-color': '#22c55e', 'target-arrow-color': '#22c55e' } },
        { selector: 'edge.enemy, edge.rival', style: { 'line-color': '#f87171', 'target-arrow-color': '#f87171', 'line-style': 'dashed' } },
        { selector: '.faded', style: { opacity: 0.12 } },
        { selector: '.hidden-rel', style: { display: 'none' } },
        { selector: 'node.selected', style: { 'border-color': '#f8fafc', 'border-width': 4 } },
        { selector: 'edge.selected, edge.hovered', style: { opacity: 1, label: 'data(label)', width: 3 } },
      ],
      layout: {
        name: 'cose',
        animate: false,
        idealEdgeLength: 150,
        nodeOverlap: 28,
        refresh: 20,
        fit: true,
        padding: 38,
        componentSpacing: 80,
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
  }, [characters, relationships, onCharacterClick]);

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
    setSelectedId(null);
    cyRef.current?.elements().removeClass('faded selected');
  }

  return (
    <div className="cyto-panel">
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
          Limpiar foco
        </button>
      </div>
      <div className="cyto-canvas" ref={containerRef} />
      <div className="graph-legend">
        {Object.entries(roleLabels).map(([role, label]) => (
          <span key={role}>
            <b className={`legend ${role}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
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
