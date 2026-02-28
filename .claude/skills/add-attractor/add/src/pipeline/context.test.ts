import { describe, it, expect } from 'vitest';
import { Context } from './context.js';

describe('Context', () => {
  it('set and get', () => {
    const ctx = new Context();
    ctx.set('key', 'value');
    expect(ctx.getString('key')).toBe('value');
  });

  it('getString returns default for missing', () => {
    const ctx = new Context();
    expect(ctx.getString('missing', 'default')).toBe('default');
  });

  it('clone creates independent copy', () => {
    const ctx = new Context();
    ctx.set('a', 'original');
    const clone = ctx.clone();
    clone.set('a', 'modified');
    expect(ctx.getString('a')).toBe('original');
    expect(clone.getString('a')).toBe('modified');
  });

  it('snapshot serializes values', () => {
    const ctx = new Context();
    ctx.set('x', 1);
    ctx.set('y', 'two');
    const snap = ctx.snapshot();
    expect(snap['x']).toBe(1);
    expect(snap['y']).toBe('two');
  });

  it('applyUpdates merges values', () => {
    const ctx = new Context();
    ctx.set('a', 'old');
    ctx.applyUpdates({ a: 'new', b: 'added' });
    expect(ctx.getString('a')).toBe('new');
    expect(ctx.getString('b')).toBe('added');
  });
});
