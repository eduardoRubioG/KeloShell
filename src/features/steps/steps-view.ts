import type { DailyStepsEntry } from '../../contracts/steps';

export interface StepsTrend {
  entries: DailyStepsEntry[];
  values: Array<number | null>;
  latest: number | null;
  average: number | null;
}

export function sortStepsEntries(
  entries: readonly DailyStepsEntry[]
): DailyStepsEntry[] {
  return [...entries].sort((left, right) => left.date.localeCompare(right.date));
}

export function entriesThroughDate(
  entries: readonly DailyStepsEntry[],
  endDate: string,
  count = 7
): DailyStepsEntry[] {
  return sortStepsEntries(entries)
    .filter((entry) => entry.date <= endDate)
    .slice(-count);
}

export function stepsTrend(
  entries: readonly DailyStepsEntry[],
  endDate: string
): StepsTrend {
  const windowEntries = entriesThroughDate(entries, endDate);
  const values = windowEntries.map(entryValue);
  const recorded = values.filter((value): value is number => value !== null);
  const latest = recorded.at(-1) ?? null;
  const average = recorded.length
    ? Math.round(
        recorded.reduce((total, value) => total + value, 0) / recorded.length
      )
    : null;

  return { entries: windowEntries, values, latest, average };
}

export function previousRecordedEntry(
  entries: readonly DailyStepsEntry[],
  selectedDate: string
): DailyStepsEntry | null {
  return (
    sortStepsEntries(entries)
      .filter((entry) => entry.date < selectedDate && entryValue(entry) !== null)
      .at(-1) ?? null
  );
}

export function entryValue(entry: DailyStepsEntry): number | null {
  if (!entry.hasValue || entry.steps === null) {
    return null;
  }
  const value = Number(entry.steps.replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}
