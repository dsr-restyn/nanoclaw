import { describe, it, expect } from 'vitest';
import { buildNodePrompt, parseOutcome, extractSummary, createContainerHandler } from './container-handler.js';
import { Context } from './context.js';
import type { Node, Graph } from './types.js';
import { stringAttr } from './types.js';

describe('buildNodePrompt', () => {
  it('builds prompt from node prompt attribute', () => {
    const node: Node = { id: 'test', attributes: new Map([['prompt', stringAttr('Review the code')]]) };
    const ctx = new Context();
    ctx.set('graph.goal', 'Add feature X');
    const prompt = buildNodePrompt(node, ctx);
    expect(prompt).toContain('Review the code');
    expect(prompt).toContain('Add feature X');
  });

  it('falls back to label when no prompt', () => {
    const node: Node = { id: 'test', attributes: new Map([['label', stringAttr('Analyze')]]) };
    const prompt = buildNodePrompt(node, new Context());
    expect(prompt).toContain('Analyze');
  });

  it('expands $goal variable', () => {
    const node: Node = { id: 'test', attributes: new Map([['prompt', stringAttr('Work toward $goal')]]) };
    const ctx = new Context();
    ctx.set('graph.goal', 'shipping');
    const prompt = buildNodePrompt(node, ctx);
    expect(prompt).toContain('Work toward shipping');
  });

  it('includes prior work summaries from context', () => {
    const node: Node = { id: 'node3', attributes: new Map([['prompt', stringAttr('Build the engine')]]) };
    const ctx = new Context();
    ctx.set('node_summary.node1', { label: 'Analyze Codebase', text: 'Found 3 modules to modify.' });
    ctx.set('node_summary.node2', { label: 'Design Architecture', text: 'Created types.py with OrderType enum.' });

    const prompt = buildNodePrompt(node, ctx);
    expect(prompt).toContain('Prior Pipeline Work');
    expect(prompt).toContain('Analyze Codebase');
    expect(prompt).toContain('Found 3 modules to modify.');
    expect(prompt).toContain('Design Architecture');
    expect(prompt).toContain('Created types.py with OrderType enum.');
    expect(prompt).toContain('Build the engine');
  });

  it('omits prior work section when no summaries exist', () => {
    const node: Node = { id: 'node1', attributes: new Map([['prompt', stringAttr('Start here')]]) };
    const prompt = buildNodePrompt(node, new Context());
    expect(prompt).not.toContain('Prior Pipeline Work');
  });

  it('trims older summaries when budget exceeded', () => {
    const ctx = new Context();
    // Create summaries that exceed the 6000 char budget
    const longText = 'line one\n' + 'x'.repeat(3000) + '\nlast line of summary';
    ctx.set('node_summary.a', { label: 'Step A', text: longText });
    ctx.set('node_summary.b', { label: 'Step B', text: longText });

    const node: Node = { id: 'c', attributes: new Map([['prompt', stringAttr('Final step')]]) };
    const prompt = buildNodePrompt(node, ctx);
    expect(prompt).toContain('Prior Pipeline Work');
    // At least one should be trimmed
    expect(prompt).toContain('[...trimmed...]');
  });
});

describe('parseOutcome', () => {
  it('parses success tag', () => {
    const result = parseOutcome('Done! Everything works.\n[outcome:success]');
    expect(result.status).toBe('success');
  });

  it('parses fail tag', () => {
    const result = parseOutcome('Tests failed.\n[outcome:fail]');
    expect(result.status).toBe('fail');
  });

  it('parses preferred_label', () => {
    const result = parseOutcome('[outcome:success]\n[preferred_label:Approve]');
    expect(result.preferredLabel).toBe('Approve');
  });

  it('defaults to success when no tag', () => {
    const result = parseOutcome('All done, looks good.');
    expect(result.status).toBe('success');
  });
});

describe('extractSummary', () => {
  it('strips outcome and preferred_label tags', () => {
    const response = 'Created types.py\n[outcome:success]\n[preferred_label:Next]';
    expect(extractSummary(response)).toBe('Created types.py');
  });

  it('returns tail of long responses', () => {
    const prefix = 'a'.repeat(2000);
    const suffix = 'b'.repeat(500);
    const response = prefix + suffix + '\n[outcome:success]';
    const summary = extractSummary(response);
    expect(summary.length).toBeLessThanOrEqual(1200);
    expect(summary).toContain('b'.repeat(500));
  });

  it('returns full text for short responses', () => {
    const response = 'Short output.\n[outcome:success]';
    expect(extractSummary(response)).toBe('Short output.');
  });
});

describe('createContainerHandler context accumulation', () => {
  const emptyGraph: Graph = { name: 'test', attributes: new Map(), nodes: new Map(), edges: [] };

  it('stores node summary in context after execution', async () => {
    const handler = createContainerHandler(async () => 'Created types.py with OrderType.\n[outcome:success]');
    const ctx = new Context();
    const node: Node = { id: 'n1', attributes: new Map([['label', stringAttr('Create Types')]]) };

    await handler(node, ctx, emptyGraph);

    const summary = ctx.get('node_summary.n1') as { label: string; text: string };
    expect(summary.label).toBe('Create Types');
    expect(summary.text).toContain('Created types.py with OrderType.');
  });

  it('accumulates summaries across multiple nodes', async () => {
    const responses = [
      'Analyzed codebase, found 3 files.\n[outcome:success]',
      'Designed architecture with Engine class.\n[outcome:success]',
      'Built engine.py using Engine class.\n[outcome:success]',
    ];
    let callIndex = 0;
    const handler = createContainerHandler(async () => responses[callIndex++]);
    const ctx = new Context();

    const node1: Node = { id: 'n1', attributes: new Map([['label', stringAttr('Analyze')]]) };
    const node2: Node = { id: 'n2', attributes: new Map([['label', stringAttr('Design')]]) };
    const node3: Node = { id: 'n3', attributes: new Map([['prompt', stringAttr('Build the engine')]]) };

    await handler(node1, ctx, emptyGraph);
    await handler(node2, ctx, emptyGraph);

    // Node 3's prompt should contain summaries from nodes 1 and 2
    const prompt = buildNodePrompt(node3, ctx);
    expect(prompt).toContain('Prior Pipeline Work');
    expect(prompt).toContain('Analyze');
    expect(prompt).toContain('found 3 files');
    expect(prompt).toContain('Design');
    expect(prompt).toContain('Engine class');
    expect(prompt).toContain('Build the engine');
  });
});
