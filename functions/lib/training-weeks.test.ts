import { describe, expect, it } from 'vitest';

import {
  LiftLogConflictError,
  readTrainingWeeks,
  SourceSpreadsheetSchemaError,
  writeLiftLog,
  SESSION_NAMES,
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
  liftName?: string;
  progression?: string;
  setCount?: number;
  repTarget?: unknown;
  formattedRepTarget?: string;
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

  async writeRange(
    sheetName: string,
    range: string,
    values: readonly unknown[]
  ): Promise<void> {
    const sheetIndex = SESSION_NAMES.indexOf(sheetName as (typeof SESSION_NAMES)[number]);
    const { row, startColumn } = parseRange(range);
    values.forEach((value, index) => {
      this.grids[sheetIndex][row][startColumn + index] = value;
      this.dates[sheetIndex][row][startColumn + index] = value;
    });
  }

  async clearRange(sheetName: string, range: string): Promise<void> {
    await this.writeRange(sheetName, range, ['', '', '', '', '']);
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
      lifts: [
        {
          name: 'Test Lift',
          status: 'complete',
          progression: 'Dynamic DP',
          setCount: 3,
          repTarget: '6-8',
          cue: 'Controlled reps',
          weight: '100',
          setResults: ['8', '8', '7'],
        },
      ],
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
    expect(response.weeks[0].sessions[0].lifts[0]).toMatchObject({
      status: 'partial',
      weight: '100',
      setResults: ['9+', '8', '7'],
    });
  });

  it('uses formatted Program Definition values for read-only display', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          repTarget: 45881,
          formattedRepTarget: '8-10',
          weeks: [{ displayDate: '6/28', rawDate: '2026-06-28' }],
        },
      ])
    );

    const response = await readTrainingWeeks(gatewayFor(sheets));

    expect(response.weeks[0].sessions[0].lifts[0].repTarget).toBe('8-10');
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

  it('separates prior-week progression guidance from current-week achievement', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          weeks: [
            {
              displayDate: '6/21',
              rawDate: '2026-06-21',
              weight: 100,
              sets: [8, 8, 7],
            },
            {
              displayDate: '6/28',
              rawDate: '2026-06-28',
              weight: 105,
              sets: [8, 7, 7],
            },
          ],
        },
      ])
    );

    const response = await readTrainingWeeks(gatewayFor(sheets));
    const firstLift = response.weeks[0].sessions[0].lifts[0];
    const lift = response.weeks[1].sessions[0].lifts[0];

    expect(firstLift.progressionPrompt).toBeNull();
    expect(firstLift.progressionAchievement).toEqual({
      message: 'Progression target reached for next week.',
    });
    expect(lift.id).toBe('test-lift');
    expect(lift.previousLog).toEqual({
      weekId: '2026-06-21',
      weekNumber: 1,
      weight: '100',
      setResults: ['8', '8', '7'],
    });
    expect(lift.progressionPrompt).toEqual({
      message: 'Eligible to progress based on Week 1.',
      recommendedWeight: '105',
      sourceWeekNumber: 1,
    });
    expect(lift.progressionAchievement).toEqual({
      message: 'Progression target reached for next week.',
    });
  });

  it('skips partial logs when finding the nearest earlier complete performance', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          weeks: [
            {
              displayDate: '6/14',
              rawDate: '2026-06-14',
              weight: 100,
              sets: [8, 8, 8],
            },
            {
              displayDate: '6/21',
              rawDate: '2026-06-21',
              weight: 105,
              sets: [8],
            },
            { displayDate: '6/28', rawDate: '2026-06-28' },
          ],
        },
      ])
    );

    const response = await readTrainingWeeks(gatewayFor(sheets));
    const lift = response.weeks[2].sessions[0].lifts[0];

    expect(lift.previousLog?.weekNumber).toBe(2);
    expect(lift.progressionPrompt).toEqual({
      message: 'Eligible to progress based on Week 1.',
      recommendedWeight: '105',
      sourceWeekNumber: 1,
    });
  });

  it('does not fall back past the nearest non-qualifying complete performance', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          weeks: [
            {
              displayDate: '6/14',
              rawDate: '2026-06-14',
              weight: 100,
              sets: [8, 8, 8],
            },
            {
              displayDate: '6/21',
              rawDate: '2026-06-21',
              weight: 105,
              sets: [7, 7, 7],
            },
            { displayDate: '6/28', rawDate: '2026-06-28' },
          ],
        },
      ])
    );

    const response = await readTrainingWeeks(gatewayFor(sheets));
    const lift = response.weeks[2].sessions[0].lifts[0];

    expect(lift.previousLog?.weekNumber).toBe(2);
    expect(lift.progressionPrompt).toBeNull();
  });

  it('uses the matched earlier lift and its historical Program Definition', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          liftName: 'DB Test Lift',
          progression: 'Dynamic DP',
          weeks: [
            {
              displayDate: '6/21',
              rawDate: '2026-06-21',
              weight: 100,
              sets: [8, 6, 6],
            },
          ],
        },
        {
          liftName: 'Dumbbell Test Lift',
          progression: 'Standard DP',
          weeks: [{ displayDate: '6/28', rawDate: '2026-06-28' }],
        },
      ])
    );

    const response = await readTrainingWeeks(gatewayFor(sheets));
    const lift = response.weeks[1].sessions[0].lifts[0];

    expect(lift.previousLog?.weekNumber).toBe(1);
    expect(lift.progressionPrompt).toEqual({
      message: 'Eligible to progress based on Week 1.',
      recommendedWeight: '105',
      sourceWeekNumber: 1,
    });
  });

  it('preserves eligibility without a weight recommendation', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          progression: '5/5/3/AMRAP',
          repTarget: '3+',
          weeks: [
            {
              displayDate: '6/21',
              rawDate: '2026-06-21',
              weight: 100,
              sets: [5, 5, 3],
            },
            { displayDate: '6/28', rawDate: '2026-06-28' },
          ],
        },
      ])
    );

    const response = await readTrainingWeeks(gatewayFor(sheets));

    expect(response.weeks[1].sessions[0].lifts[0].progressionPrompt).toEqual({
      message: 'Eligible to progress based on Week 1.',
      recommendedWeight: null,
      sourceWeekNumber: 1,
    });
  });

  it('omits progression states for unsupported schemes', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          progression: 'Coach review',
          weeks: [
            {
              displayDate: '6/21',
              rawDate: '2026-06-21',
              weight: 100,
              sets: [8, 8, 8],
            },
            { displayDate: '6/28', rawDate: '2026-06-28' },
          ],
        },
      ])
    );

    const response = await readTrainingWeeks(gatewayFor(sheets));

    expect(response.weeks[0].sessions[0].lifts[0].progressionAchievement).toBeNull();
    expect(response.weeks[1].sessions[0].lifts[0].progressionPrompt).toBeNull();
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

describe('writeLiftLog', () => {
  it('writes, confirms, and clears one complete Lift Log', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          weeks: [{ displayDate: '6/28', rawDate: '2026-06-28' }],
        },
      ])
    );
    const gateway = gatewayFor(sheets);
    const initial = await readTrainingWeeks(gateway);
    const lift = initial.weeks[0].sessions[0].lifts[0];

    const saved = await writeLiftLog(gateway, {
      operation: 'save',
      weekId: '2026-06-28',
      session: 'Upper A',
      liftId: lift.id,
      revision: lift.revision,
      weight: 102.5,
      setResults: [8, 8, 7],
    });
    const savedLift = saved.weeks[0].sessions[0].lifts[0];
    expect(savedLift).toMatchObject({
      status: 'complete',
      weight: '102.5',
      setResults: ['8', '8', '7'],
      progressionPrompt: null,
      progressionAchievement: {
        message: 'Progression target reached for next week.',
      },
    });

    const cleared = await writeLiftLog(gateway, {
      operation: 'clear',
      weekId: '2026-06-28',
      session: 'Upper A',
      liftId: savedLift.id,
      revision: savedLift.revision,
    });
    expect(cleared.weeks[0].sessions[0].lifts[0].status).toBe('not-started');
  });

  it('rejects a stale Lift Log revision', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          weeks: [{ displayDate: '6/28', rawDate: '2026-06-28' }],
        },
      ])
    );
    const gateway = gatewayFor(sheets);

    await expect(
      writeLiftLog(gateway, {
        operation: 'clear',
        weekId: '2026-06-28',
        session: 'Upper A',
        liftId: 'test-lift',
        revision: 'stale',
      })
    ).rejects.toBeInstanceOf(LiftLogConflictError);
  });
});

function gatewayFor(
  sheets: Array<{ grid: unknown[][]; dates: unknown[][] }>
): FixtureGateway {
  return new FixtureGateway(
    sheets.map((sheet) => sheet.grid),
    sheets.map((sheet) =>
      sheet.grid.map((row, rowIndex) => {
        const formatted = [...row];
        for (const [columnIndex, value] of (
          sheet.dates[rowIndex] ?? []
        ).entries()) {
          if (value !== undefined) {
            formatted[columnIndex] = value;
          }
        }
        return formatted;
      })
    )
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
    grid.push(['Lift', block.liftName ?? 'Test Lift']);
    grid.push(['Progression', block.progression ?? 'Dynamic DP']);
    grid.push(['Sets', block.setCount ?? 3]);
    grid.push(['Reps', block.repTarget ?? '6-8']);
    grid.push(['Cue', 'Controlled reps']);
    grid.push(['Week', 'Weight', 1, 2, 3, 4]);
    dates.push(
      [],
      [],
      [],
      block.formattedRepTarget === undefined
        ? []
        : [undefined, block.formattedRepTarget],
      [],
      []
    );

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

function parseRange(range: string): { row: number; startColumn: number } {
  const match = /^([A-Z]+)(\d+):[A-Z]+\d+$/.exec(range);
  if (!match) {
    throw new Error(`Unexpected range: ${range}`);
  }
  let column = 0;
  for (const character of match[1]) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]) - 1, startColumn: column - 1 };
}
