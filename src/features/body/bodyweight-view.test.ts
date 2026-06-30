import { describe, expect, it } from 'vitest';

import type { DailyBodyweightEntry } from '../../contracts/body';
import {
  bodyweightTrend,
  entriesThroughDate,
  previousRecordedEntry,
  sparklineSegments,
} from './bodyweight-view';

function entry(date: string, weight: string | null): DailyBodyweightEntry {
  return {
    date,
    weight,
    hasValue: weight !== null,
    revision: date,
  };
}

describe('bodyweight view calculations', () => {
  const entries = [
    entry('2026-06-23', '185.2'),
    entry('2026-06-24', '184.6'),
    entry('2026-06-25', null),
    entry('2026-06-26', '184.4'),
    entry('2026-06-27', '183.8'),
    entry('2026-06-28', '183.4'),
    entry('2026-06-29', null),
    entry('2026-06-30', '182.8'),
  ];

  it('uses the latest seven source dates through the selected date', () => {
    expect(entriesThroughDate(entries, '2026-06-29').map((item) => item.date)).toEqual([
      '2026-06-23',
      '2026-06-24',
      '2026-06-25',
      '2026-06-26',
      '2026-06-27',
      '2026-06-28',
      '2026-06-29',
    ]);
  });

  it('calculates latest, change, and average from recorded values only', () => {
    const trend = bodyweightTrend(entries, '2026-06-29');

    expect(trend.latest).toBe(183.4);
    expect(trend.change).toBeCloseTo(-1.8);
    expect(trend.average).toBeCloseTo(184.28);
  });

  it('returns no change when fewer than two values are recorded', () => {
    const trend = bodyweightTrend([entry('2026-06-29', '184.2')], '2026-06-29');

    expect(trend.latest).toBe(184.2);
    expect(trend.change).toBeNull();
  });

  it('finds the nearest earlier recorded entry', () => {
    expect(previousRecordedEntry(entries, '2026-06-29')?.date).toBe('2026-06-28');
    expect(previousRecordedEntry(entries, '2026-06-23')).toBeNull();
  });

  it('breaks sparkline segments across missing values', () => {
    const segments = sparklineSegments([185.2, 184.6, null, 184.4, 183.8], 100, 40);

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.length)).toEqual([2, 2]);
  });
});
