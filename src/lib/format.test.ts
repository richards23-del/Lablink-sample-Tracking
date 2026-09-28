import { describe, expect, it } from 'vitest';
import {
  barPercentage,
  formatRelative,
  parseSampleId,
  toDateTimeLocal,
} from './format';

describe('operational display edge cases', () => {
  it('distinguishes missing, invalid, past and future timestamps', () => {
    const now = Date.parse('2026-09-22T10:00:00Z');
    expect(formatRelative(null, now)).toBe('—');
    expect(formatRelative('bad timestamp', now)).toBe('Unknown time');
    expect(formatRelative('2026-09-22T09:58:00Z', now)).toBe('2 minutes ago');
    expect(formatRelative('2026-09-22T10:02:00Z', now)).toBe('in 2 minutes');
  });
  it('never represents zero volume as a positive or invalid bar', () => {
    expect(barPercentage(0, 0)).toBe(0);
    expect(barPercentage(0, 20)).toBe(0);
    expect(barPercentage(5, 20)).toBe(25);
    expect(barPercentage(NaN, 20)).toBe(0);
  });
  it('rejects noncanonical or unsafe record IDs', () => {
    for (const value of [
      '0',
      '-1',
      '1.2',
      '1e2',
      'abc',
      '01',
      '9007199254740992',
    ])
      expect(parseSampleId(value)).toBeNull();
    expect(parseSampleId('42')).toBe(42);
  });
  it('can round-trip a collection datetime through a browser-local input', () => {
    const date = new Date(2026, 8, 22, 10, 15);
    expect(new Date(toDateTimeLocal(date)).getTime()).toBe(date.getTime());
  });
});
