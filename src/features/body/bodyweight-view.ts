import type { DailyBodyweightEntry } from '../../contracts/body';

export interface BodyweightTrend {
  entries: DailyBodyweightEntry[];
  values: Array<number | null>;
  latest: number | null;
  change: number | null;
  average: number | null;
}

export interface SparklinePoint {
  x: number;
  y: number;
}

export function sortBodyweightEntries(
  entries: readonly DailyBodyweightEntry[]
): DailyBodyweightEntry[] {
  return [...entries].sort((left, right) => left.date.localeCompare(right.date));
}

export function entriesThroughDate(
  entries: readonly DailyBodyweightEntry[],
  endDate: string,
  count = 7
): DailyBodyweightEntry[] {
  return sortBodyweightEntries(entries)
    .filter((entry) => entry.date <= endDate)
    .slice(-count);
}

export function bodyweightTrend(
  entries: readonly DailyBodyweightEntry[],
  endDate: string
): BodyweightTrend {
  const windowEntries = entriesThroughDate(entries, endDate);
  const values = windowEntries.map(entryValue);
  const recorded = values.filter((value): value is number => value !== null);
  const latest = recorded.at(-1) ?? null;
  const change =
    recorded.length >= 2 && latest !== null ? latest - recorded[0] : null;
  const average = recorded.length
    ? recorded.reduce((total, value) => total + value, 0) / recorded.length
    : null;

  return {
    entries: windowEntries,
    values,
    latest,
    change,
    average,
  };
}

export function previousRecordedEntry(
  entries: readonly DailyBodyweightEntry[],
  selectedDate: string
): DailyBodyweightEntry | null {
  return (
    sortBodyweightEntries(entries)
      .filter((entry) => entry.date < selectedDate && entryValue(entry) !== null)
      .at(-1) ?? null
  );
}

export function sparklineSegments(
  values: readonly (number | null)[],
  width: number,
  height: number,
  padding = 6
): SparklinePoint[][] {
  const recorded = values.filter((value): value is number => value !== null);
  if (!recorded.length) {
    return [];
  }

  const min = Math.min(...recorded);
  const max = Math.max(...recorded);
  const range = max - min;
  const xRange = Math.max(width - padding * 2, 0);
  const yRange = Math.max(height - padding * 2, 0);
  const denominator = Math.max(values.length - 1, 1);
  const segments: SparklinePoint[][] = [];
  let current: SparklinePoint[] = [];

  values.forEach((value, index) => {
    if (value === null) {
      if (current.length) {
        segments.push(current);
        current = [];
      }
      return;
    }

    const y =
      range === 0
        ? height / 2
        : padding + ((max - value) / range) * yRange;
    current.push({
      x: padding + (index / denominator) * xRange,
      y,
    });
  });

  if (current.length) {
    segments.push(current);
  }
  return segments;
}

export function entryValue(entry: DailyBodyweightEntry): number | null {
  if (!entry.hasValue || entry.weight === null) {
    return null;
  }
  const value = Number(entry.weight);
  return Number.isFinite(value) && value > 0 ? value : null;
}
