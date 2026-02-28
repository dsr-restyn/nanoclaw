import { describe, it, expect } from 'vitest';
import { evaluateCondition } from './conditions.js';
import { Context } from './context.js';
import { createOutcome, StageStatus } from './outcome.js';

function makeOutcome(status: string, preferredLabel = '') {
  return createOutcome({ status: status as any, preferredLabel });
}

describe('evaluateCondition', () => {
  it('empty condition is true', () => {
    expect(evaluateCondition('', makeOutcome('success'), new Context())).toBe(true);
  });

  it('outcome=success matches', () => {
    expect(evaluateCondition('outcome=success', makeOutcome('success'), new Context())).toBe(true);
  });

  it('outcome=success does not match fail', () => {
    expect(evaluateCondition('outcome=success', makeOutcome('fail'), new Context())).toBe(false);
  });

  it('outcome!=success matches fail', () => {
    expect(evaluateCondition('outcome!=success', makeOutcome('fail'), new Context())).toBe(true);
  });

  it('AND clauses both must pass', () => {
    const ctx = new Context();
    ctx.set('context.ready', 'true');
    expect(evaluateCondition('outcome=success && context.ready=true', makeOutcome('success'), ctx)).toBe(true);
    expect(evaluateCondition('outcome=success && context.ready=false', makeOutcome('success'), ctx)).toBe(false);
  });

  it('resolves context keys', () => {
    const ctx = new Context();
    ctx.set('my_flag', 'yes');
    expect(evaluateCondition('my_flag=yes', makeOutcome('success'), ctx)).toBe(true);
  });
});
