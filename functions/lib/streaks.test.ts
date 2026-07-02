import { describe, expect, it } from 'vitest';

import {
  consecutiveStreak,
  computeWorkoutStreakFromWeeks,
  readCreatineDates,
  logCreatine,
  type HabitsGateway,
} from './streaks';
import type { TrainingWeeksResponse } from '../../src/contracts/training';

const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86_400_000;
function serial(isoDate: string): number {
  return (Date.parse(`${isoDate}T00:00:00Z`) - SHEETS_EPOCH) / DAY;
}

class MockHabitsGateway implements HabitsGateway {
  private rows: unknown[][];

  constructor(dataRows: unknown[][] = []) {
    this.rows = [['Date', 'Habit'], ...dataRows];
  }

  getRows(): unknown[][] {
    return this.rows;
  }

  async readRanges(
    _ranges: readonly string[],
    _option: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]> {
    return [this.rows];
  }

  async writeRange(
    _sheetName: string,
    range: string,
    values: readonly unknown[]
  ): Promise<void> {
    const match = /A(\d+):B\d+/.exec(range);
    if (!match) return;
    const rowIndex = Number(match[1]) - 1;
    while (this.rows.length <= rowIndex) {
      this.rows.push([]);
    }
    this.rows[rowIndex] = [...values];
  }

  async clearRange(_sheetName: string, range: string): Promise<void> {
    const match = /A(\d+):B\d+/.exec(range);
    if (!match) return;
    const rowIndex = Number(match[1]) - 1;
    if (rowIndex < this.rows.length) {
      this.rows[rowIndex] = [];
    }
  }
}

function makeWeek(
  id: string,
  completedSessions: number
): TrainingWeeksResponse['weeks'][number] {
  const endDate = new Date(`${id}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  return {
    id,
    weekNumber: 1,
    startDate: id,
    endDate: endDate.toISOString().slice(0, 10),
    availability: 'available',
    status: completedSessions === 4 ? 'complete' : completedSessions > 0 ? 'partial' : 'not-started',
    completedSessions,
    sessions: [],
  };
}

describe('consecutiveStreak', () => {
  it('counts from today when today is logged', () => {
    const dates = new Set(['2026-07-02', '2026-07-01', '2026-06-30']);
    expect(consecutiveStreak(dates, '2026-07-02')).toEqual({
      count: 3,
      todayComplete: true,
    });
  });

  it('counts from yesterday when today is not logged', () => {
    const dates = new Set(['2026-07-01', '2026-06-30']);
    expect(consecutiveStreak(dates, '2026-07-02')).toEqual({
      count: 2,
      todayComplete: false,
    });
  });

  it('returns 0 when neither today nor yesterday is logged', () => {
    const dates = new Set(['2026-06-29']);
    expect(consecutiveStreak(dates, '2026-07-02')).toEqual({
      count: 0,
      todayComplete: false,
    });
  });

  it('returns 0 for empty set', () => {
    expect(consecutiveStreak(new Set(), '2026-07-02')).toEqual({
      count: 0,
      todayComplete: false,
    });
  });

  it('stops at a gap in the streak', () => {
    const dates = new Set(['2026-07-02', '2026-06-30']); // gap on 2026-07-01
    expect(consecutiveStreak(dates, '2026-07-02')).toEqual({
      count: 1,
      todayComplete: true,
    });
  });

  it('counts a single entry today as streak of 1', () => {
    const dates = new Set(['2026-07-02']);
    expect(consecutiveStreak(dates, '2026-07-02')).toEqual({
      count: 1,
      todayComplete: true,
    });
  });

  it('counts yesterday alone as streak of 1', () => {
    const dates = new Set(['2026-07-01']);
    expect(consecutiveStreak(dates, '2026-07-02')).toEqual({
      count: 1,
      todayComplete: false,
    });
  });
});

describe('computeWorkoutStreakFromWeeks', () => {
  it('counts consecutive complete weeks ending at the current week', () => {
    const response: TrainingWeeksResponse = {
      defaultWeekId: '2026-06-29',
      weeks: [
        makeWeek('2026-06-15', 4),
        makeWeek('2026-06-22', 4),
        makeWeek('2026-06-29', 4),
      ],
    };
    const result = computeWorkoutStreakFromWeeks(response, '2026-07-01');
    expect(result).toEqual({ count: 3, todayComplete: true });
  });

  it('excludes current week when it is not complete', () => {
    const response: TrainingWeeksResponse = {
      defaultWeekId: '2026-06-29',
      weeks: [
        makeWeek('2026-06-15', 4),
        makeWeek('2026-06-22', 4),
        makeWeek('2026-06-29', 2),
      ],
    };
    const result = computeWorkoutStreakFromWeeks(response, '2026-07-01');
    expect(result).toEqual({ count: 2, todayComplete: false });
  });

  it('stops at first incomplete week when walking backward', () => {
    const response: TrainingWeeksResponse = {
      defaultWeekId: '2026-06-29',
      weeks: [
        makeWeek('2026-06-08', 4),
        makeWeek('2026-06-15', 2), // breaks the run
        makeWeek('2026-06-22', 4),
        makeWeek('2026-06-29', 4),
      ],
    };
    const result = computeWorkoutStreakFromWeeks(response, '2026-07-01');
    expect(result).toEqual({ count: 2, todayComplete: true });
  });

  it('returns 0 when no available weeks exist', () => {
    const response: TrainingWeeksResponse = {
      defaultWeekId: null,
      weeks: [],
    };
    expect(computeWorkoutStreakFromWeeks(response, '2026-07-01')).toEqual({
      count: 0,
      todayComplete: false,
    });
  });

  it('falls back to defaultWeek when today is not inside any week', () => {
    const response: TrainingWeeksResponse = {
      defaultWeekId: '2026-06-22',
      weeks: [makeWeek('2026-06-22', 4)],
    };
    // today is after the week's endDate
    const result = computeWorkoutStreakFromWeeks(response, '2026-07-10');
    expect(result).toEqual({ count: 1, todayComplete: true });
  });
});

describe('readCreatineDates', () => {
  it('returns ISO dates for creatine entries', async () => {
    const gateway = new MockHabitsGateway([
      ['2026-07-01', 'creatine'],
      ['2026-07-02', 'creatine'],
    ]);
    const dates = await readCreatineDates(gateway);
    expect(dates.has('2026-07-01')).toBe(true);
    expect(dates.has('2026-07-02')).toBe(true);
    expect(dates.size).toBe(2);
  });

  it('handles serial number dates from Google Sheets', async () => {
    const gateway = new MockHabitsGateway([[serial('2026-07-01'), 'creatine']]);
    const dates = await readCreatineDates(gateway);
    expect(dates.has('2026-07-01')).toBe(true);
  });

  it('ignores non-creatine habits', async () => {
    const gateway = new MockHabitsGateway([['2026-07-01', 'vitamin-d']]);
    const dates = await readCreatineDates(gateway);
    expect(dates.size).toBe(0);
  });

  it('returns empty set for an empty habits tab', async () => {
    const gateway = new MockHabitsGateway([]);
    const dates = await readCreatineDates(gateway);
    expect(dates.size).toBe(0);
  });
});

describe('logCreatine', () => {
  it('appends a creatine row when logging a new date', async () => {
    const gateway = new MockHabitsGateway([]);
    await logCreatine(gateway, { operation: 'log', date: '2026-07-02' });
    const dates = await readCreatineDates(gateway);
    expect(dates.has('2026-07-02')).toBe(true);
  });

  it('does not duplicate an entry when logging the same date twice', async () => {
    const gateway = new MockHabitsGateway([['2026-07-02', 'creatine']]);
    await logCreatine(gateway, { operation: 'log', date: '2026-07-02' });
    const dates = await readCreatineDates(gateway);
    expect(dates.size).toBe(1);
  });

  it('clears the matching row on unlog', async () => {
    const gateway = new MockHabitsGateway([['2026-07-02', 'creatine']]);
    await logCreatine(gateway, { operation: 'unlog', date: '2026-07-02' });
    const dates = await readCreatineDates(gateway);
    expect(dates.has('2026-07-02')).toBe(false);
  });

  it('does nothing on unlog when date is not found', async () => {
    const gateway = new MockHabitsGateway([['2026-07-01', 'creatine']]);
    await logCreatine(gateway, { operation: 'unlog', date: '2026-07-02' });
    const dates = await readCreatineDates(gateway);
    expect(dates.has('2026-07-01')).toBe(true);
  });

  it('only unlog clears creatine rows, not other habits on the same date', async () => {
    const gateway = new MockHabitsGateway([
      ['2026-07-02', 'vitamin-d'],
      ['2026-07-02', 'creatine'],
    ]);
    await logCreatine(gateway, { operation: 'unlog', date: '2026-07-02' });
    const rows = gateway.getRows();
    // vitamin-d row should still be intact
    expect(rows[1]).toEqual(['2026-07-02', 'vitamin-d']);
  });
});
