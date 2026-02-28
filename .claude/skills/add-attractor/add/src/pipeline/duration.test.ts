import { describe, it, expect } from 'vitest';
import { parseDuration, isDurationString } from './duration.js';

describe('parseDuration', () => {
  it('parses milliseconds', () => expect(parseDuration('500ms')).toBe(500));
  it('parses seconds', () => expect(parseDuration('30s')).toBe(30000));
  it('parses minutes', () => expect(parseDuration('5m')).toBe(300000));
  it('parses hours', () => expect(parseDuration('2h')).toBe(7200000));
  it('parses days', () => expect(parseDuration('1d')).toBe(86400000));
  it('throws on invalid', () => expect(() => parseDuration('abc')).toThrow());
});

describe('isDurationString', () => {
  it('recognizes durations', () => expect(isDurationString('30s')).toBe(true));
  it('rejects non-durations', () => expect(isDurationString('hello')).toBe(false));
});
