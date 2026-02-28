import { describe, it, expect } from 'vitest';
import { validateGraph } from './validate.js';
import { tokenize } from './lexer.js';
import { parseTokens } from './parser.js';

function parse(dot: string) {
  return parseTokens(tokenize(dot));
}

describe('validateGraph', () => {
  it('accepts valid graph', () => {
    const graph = parse(`digraph G {
      start [shape=Mdiamond]
      exit [shape=Msquare]
      start -> exit
    }`);
    const result = validateGraph(graph);
    expect(result.errors.length).toBe(0);
  });

  it('rejects missing start node', () => {
    const graph = parse(`digraph G { exit [shape=Msquare] }`);
    const result = validateGraph(graph);
    expect(result.errors.some(e => e.includes('start'))).toBe(true);
  });

  it('rejects missing exit node', () => {
    const graph = parse(`digraph G { start [shape=Mdiamond] }`);
    const result = validateGraph(graph);
    expect(result.errors.some(e => e.includes('exit'))).toBe(true);
  });

  it('rejects start with incoming edges', () => {
    const graph = parse(`digraph G {
      start [shape=Mdiamond]
      exit [shape=Msquare]
      a -> start
      start -> exit
    }`);
    const result = validateGraph(graph);
    expect(result.errors.some(e => e.includes('incoming'))).toBe(true);
  });

  it('warns on missing prompt for codergen node', () => {
    const graph = parse(`digraph G {
      start [shape=Mdiamond]
      work [shape=box]
      exit [shape=Msquare]
      start -> work -> exit
    }`);
    const result = validateGraph(graph);
    expect(result.warnings.some(w => w.includes('prompt') || w.includes('label'))).toBe(true);
  });
});
