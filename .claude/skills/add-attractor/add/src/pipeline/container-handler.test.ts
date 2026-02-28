import { describe, it, expect } from 'vitest';
import { buildNodePrompt, parseOutcome } from './container-handler.js';
import { Context } from './context.js';
import type { Node } from './types.js';
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
