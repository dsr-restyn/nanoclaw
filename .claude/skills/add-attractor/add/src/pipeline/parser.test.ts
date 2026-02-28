import { describe, it, expect } from 'vitest';
import { tokenize } from './lexer.js';
import { parseTokens } from './parser.js';

function parse(dot: string) {
  return parseTokens(tokenize(dot));
}

describe('DOT parser', () => {
  it('parses minimal graph', () => {
    const graph = parse('digraph G { start [shape=Mdiamond]; exit [shape=Msquare]; start -> exit }');
    expect(graph.name).toBe('G');
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.length).toBe(1);
  });

  it('parses graph attributes', () => {
    const graph = parse('digraph G { graph [goal="Test pipeline"] }');
    const goal = graph.attributes.get('goal');
    expect(goal).toBeDefined();
    expect(goal?.kind).toBe('string');
    expect(goal?.value).toBe('Test pipeline');
  });

  it('parses node with prompt', () => {
    const graph = parse('digraph G { analyze [label="Analyze", prompt="Review the code"] }');
    const node = graph.nodes.get('analyze');
    expect(node).toBeDefined();
    expect(node?.attributes.get('prompt')?.value).toBe('Review the code');
  });

  it('parses edge conditions', () => {
    const graph = parse('digraph G { a -> b [condition="outcome=success"] }');
    expect(graph.edges[0]?.attributes.get('condition')?.value).toBe('outcome=success');
  });

  it('parses chained edges', () => {
    const graph = parse('digraph G { a -> b -> c }');
    expect(graph.edges.length).toBe(2);
    expect(graph.edges[0]?.from).toBe('a');
    expect(graph.edges[0]?.to).toBe('b');
    expect(graph.edges[1]?.from).toBe('b');
    expect(graph.edges[1]?.to).toBe('c');
  });

  it('rejects non-digraph', () => {
    expect(() => parse('graph G { a -> b }')).toThrow();
  });
});
