import { describe, it, expect } from 'vitest';
import { selectEdge } from './edge-selection.js';
import { Context } from './context.js';
import { createOutcome, StageStatus } from './outcome.js';
import type { Graph, Node, Edge } from './types.js';
import { stringAttr, integerAttr } from './types.js';

function makeGraph(nodes: Node[], edges: Edge[]): Graph {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  return { name: 'Test', attributes: new Map(), nodes: nodeMap, edges };
}

function makeNode(id: string): Node {
  return { id, attributes: new Map() };
}

function makeEdge(from: string, to: string, attrs: Record<string, any> = {}): Edge {
  const attrMap = new Map<string, any>();
  for (const [k, v] of Object.entries(attrs)) {
    attrMap.set(k, typeof v === 'string' ? stringAttr(v) : integerAttr(v));
  }
  return { from, to, attributes: attrMap };
}

describe('selectEdge', () => {
  it('selects condition-matching edge', () => {
    const graph = makeGraph(
      [makeNode('a'), makeNode('b'), makeNode('c')],
      [
        makeEdge('a', 'b', { condition: 'outcome=success' }),
        makeEdge('a', 'c', { condition: 'outcome=fail' }),
      ],
    );
    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const edge = selectEdge(graph.nodes.get('a')!, outcome, new Context(), graph);
    expect(edge?.to).toBe('b');
  });

  it('falls back to unconditional edge', () => {
    const graph = makeGraph(
      [makeNode('a'), makeNode('b')],
      [makeEdge('a', 'b')],
    );
    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const edge = selectEdge(graph.nodes.get('a')!, outcome, new Context(), graph);
    expect(edge?.to).toBe('b');
  });

  it('uses weight for tiebreaking', () => {
    const graph = makeGraph(
      [makeNode('a'), makeNode('b'), makeNode('c')],
      [
        makeEdge('a', 'b', { weight: 1 }),
        makeEdge('a', 'c', { weight: 10 }),
      ],
    );
    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const edge = selectEdge(graph.nodes.get('a')!, outcome, new Context(), graph);
    expect(edge?.to).toBe('c');
  });

  it('returns undefined when no edges', () => {
    const graph = makeGraph([makeNode('a')], []);
    const outcome = createOutcome({ status: StageStatus.SUCCESS });
    const edge = selectEdge(graph.nodes.get('a')!, outcome, new Context(), graph);
    expect(edge).toBeUndefined();
  });
});
