import { describe, expect, it } from 'vitest';
import { todayLocalIsoDate } from './local-date';

describe('todayLocalIsoDate', () => {
  it('returns YYYY-MM-DD in the local timezone', () => {
    const result = todayLocalIsoDate(new Date(2026, 5, 29)); // June 29, 2026 local
    expect(result).toBe('2026-06-29');
  });

  it('zero-pads month and day', () => {
    expect(todayLocalIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('handles the last day of the year', () => {
    expect(todayLocalIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
