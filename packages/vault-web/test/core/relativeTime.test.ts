import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../../src/core/headless/relativeTime.js';

const NOW = new Date('2026-11-02T10:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const MIN = 60e3;

describe('formatRelativeTime', () => {
  it.each([
    [-10e3, 'just now'],
    [-5 * MIN, '5m ago'],
    [-3 * 60 * MIN, '3h ago'],
    [-49 * 60 * MIN, '2d ago'],
    [10e3, 'in under a minute'],
    [9 * 60 * MIN, 'in 9h'],
    [3 * 24 * 60 * MIN, 'in 3d'],
  ])('offset %d ms -> %s', (offset, expected) => {
    expect(formatRelativeTime(at(offset), NOW)).toBe(expected);
  });

  it('falls back to a short date beyond 30 days', () => {
    const iso = at(-40 * 24 * 60 * MIN);
    expect(formatRelativeTime(iso, NOW)).toBe(
      new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    );
  });

  it.each([null, undefined, '', 'not a date'])('returns an empty string for %s', (value) => {
    expect(formatRelativeTime(value, NOW)).toBe('');
  });
});
