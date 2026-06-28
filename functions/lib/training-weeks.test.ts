import { describe, expect, it } from 'vitest';

import {
  readTrainingWeeks,
  SourceSpreadsheetSchemaError,
  type TrainingWeeksGateway,
} from './training-weeks';

const DAY = 86_400_000;
const SHEETS_EPOCH = Date.UTC(1899, 11, 30);

interface WeekFixture {
  displayDate: string;
  rawDate: string;
  weight?: unknown;
  sets?: unknown[];
}

interface BlockFixture {
  setCount?: number;
  repTarget?: string;
  weeks: WeekFixture[];
}

class FixtureGateway implements TrainingWeeksGateway {
  constructor(
    private readonly grids: unknown[][][],
    private readonly dates: unknown[][][]
  ) {}

  async readRanges(
    _ranges: readonly string[],
    option: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]> {
    return option === 'UNFORMATTED_VALUE' ? this.grids : this.dates;
  }
}

describe('readTrainingWeeks', () => {
  it('normalizes New Year rollover and derives complete and partial statuses', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          weeks: [
            {
              displayDate: '12/28',
              rawDate: '2025-12-28',
              weight: 100,
              sets: [8, 8, 7],
            },
            {
              displayDate: '1/4',
              rawDate: '2025-01-04',
              weight: 105,
              sets: [8],
            },
          ],
        },
      ])
    );
    const response = await readTrainingWeeks(gatewayFor(sheets));

    expect(response.defaultWeekId).toBe('2026-01-04');
    expect(response.weeks).toMatchObject([
      {
        id: '2025-12-28',
        weekNumber: 1,
        endDate: '2026-01-03',
        status: 'complete',
        completedSessions: 4,
      },
      {
        id: '2026-01-04',
        weekNumber: 2,
        status: 'partial',
        completedSessions: 0,
      },
    ]);
    expect(response.weeks[0].sessions[0]).toMatchObject({
      status: 'complete',
      completedLifts: 1,
      totalLifts: 1,
    });
  });

  it('treats malformed existing values as partial rather than complete', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          weeks: [
            {
              displayDate: '6/28',
              rawDate: '2026-06-28',
              weight: 100,
              sets: ['9+', 8, 7],
            },
          ],
        },
      ])
    );
    const response = await readTrainingWeeks(gatewayFor(sheets));

    expect(response.weeks[0].status).toBe('partial');
    expect(response.weeks[0].sessions[0].completedLifts).toBe(0);
  });

  it('preserves week rows with blank or unusable definitions as unavailable', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          weeks: [
            {
              displayDate: '6/28',
              rawDate: '2026-06-28',
              weight: 100,
              sets: [8, 8, 8],
            },
          ],
        },
        {
          repTarget: '',
          weeks: [
            { displayDate: '7/5', rawDate: '2026-07-05' },
          ],
        },
      ])
    );
    const response = await readTrainingWeeks(gatewayFor(sheets));

    expect(response.defaultWeekId).toBe('2026-06-28');
    expect(response.weeks[1]).toMatchObject({
      id: '2026-07-05',
      availability: 'unavailable',
      status: null,
      sessions: [],
    });
  });

  it('uses the latest available week when every available week is complete', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          weeks: [
            {
              displayDate: '6/21',
              rawDate: '2026-06-21',
              weight: 100,
              sets: [8, 8, 8],
            },
            {
              displayDate: '6/28',
              rawDate: '2026-06-28',
              weight: 105,
              sets: [8, 8, 8],
            },
          ],
        },
      ])
    );
    const response = await readTrainingWeeks(gatewayFor(sheets));

    expect(response.defaultWeekId).toBe('2026-06-28');
  });

  it('rejects mismatched Training Week sequences across sessions', async () => {
    const matching = makeSheet([
      {
        weeks: [{ displayDate: '6/28', rawDate: '2026-06-28' }],
      },
    ]);
    const mismatch = makeSheet([
      {
        weeks: [{ displayDate: '7/5', rawDate: '2026-07-05' }],
      },
    ]);

    await expect(
      readTrainingWeeks(gatewayFor([matching, matching, matching, mismatch]))
    ).rejects.toBeInstanceOf(SourceSpreadsheetSchemaError);
  });

  it('marks set counts above the sheet capacity unavailable', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          setCount: 5,
          weeks: [{ displayDate: '6/28', rawDate: '2026-06-28' }],
        },
      ])
    );
    const response = await readTrainingWeeks(gatewayFor(sheets));

    expect(response.defaultWeekId).toBeNull();
    expect(response.weeks[0].availability).toBe('unavailable');
  });
});

function gatewayFor(
  sheets: Array<{ grid: unknown[][]; dates: unknown[][] }>
): FixtureGateway {
  return new FixtureGateway(
    sheets.map((sheet) => sheet.grid),
    sheets.map((sheet) => sheet.dates)
  );
}

function makeSheet(blocks: BlockFixture[]): {
  grid: unknown[][];
  dates: unknown[][];
} {
  const grid: unknown[][] = [];
  const dates: unknown[][] = [];

  for (const block of blocks) {
    const start = grid.length;
    grid.push(['Lift', 'Test Lift']);
    grid.push(['Progression', 'Dynamic DP']);
    grid.push(['Sets', block.setCount ?? 3]);
    grid.push(['Reps', block.repTarget ?? '6-8']);
    grid.push(['Cue', 'Controlled reps']);
    grid.push(['Week', 'Weight', 1, 2, 3, 4]);
    dates.push([], [], [], [], [], []);

    for (const week of block.weeks) {
      grid.push([
        serial(week.rawDate),
        week.weight ?? '',
        ...(week.sets ?? []),
      ]);
      dates.push([week.displayDate]);
    }
    if (grid.length === start) {
      throw new Error('Fixture block was not created.');
    }
  }

  return { grid, dates };
}

function serial(isoDate: string): number {
  return (Date.parse(`${isoDate}T00:00:00Z`) - SHEETS_EPOCH) / DAY;
}
