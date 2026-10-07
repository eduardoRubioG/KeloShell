import { describe, expect, it, vi } from 'vitest';

import { LiftLogConflictError } from '../lib/lift-log-errors';
import { resolveCoachTemplate } from '../coach-templates/registry';
import { FORMAT_MESSAGE, SourceSpreadsheetSchemaError } from '../lib/format-problems';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';
import {
  fakeSpreadsheetOf,
  overlayFormatted,
  serialDate,
  workoutSessionGrids,
  DEFAULT_SESSION_TITLES,
} from '../testing/fake-spreadsheet';
import * as training from './training';

const template = resolveCoachTemplate('eduardo');
const readTrainingWeeks = (gateway: SpreadsheetGateway) =>
  training.readTrainingWeeks(gateway, template);
const writeLiftLog = (
  gateway: SpreadsheetGateway,
  request: Parameters<typeof training.writeLiftLog>[2]
) => training.writeLiftLog(gateway, template, request);
const makeSheet = workoutSessionGrids;
const readTrainingReport = (gateway: SpreadsheetGateway) =>
  training.readTrainingReport(gateway, template);
const gatewayFor = fakeSpreadsheetOf;
const serial = serialDate;

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

  it('renders a Sets range with optional trailing sets and completes on the lower bound', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          setsCell: '2-3',
          weeks: [
            {
              displayDate: '6/28',
              rawDate: '2026-06-28',
              weight: 100,
              sets: [8, 8],
            },
          ],
        },
      ])
    );
    const response = await readTrainingWeeks(gatewayFor(sheets));

    expect(response.weeks[0].sessions[0]).toMatchObject({
      status: 'complete',
      lifts: [
        {
          minSetCount: 2,
          setCount: 3,
          status: 'complete',
          setResults: ['8', '8', null],
        },
      ],
    });
  });

  it('rejects a Sets range outside the supported 1-4 bound', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          setsCell: '3-5',
          weeks: [
            { displayDate: '6/28', rawDate: '2026-06-28', weight: '', sets: [] },
          ],
        },
      ])
    );
    const response = await readTrainingWeeks(gatewayFor(sheets));

    expect(response.weeks[0].availability).toBe('unavailable');
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

  it('skips past weeks whose every session was at least touched, landing on the first untouched week', async () => {
    const sheets = DEFAULT_SESSION_TITLES.map(() =>
      makeSheet([
        {
          weeks: [
            {
              displayDate: '6/14',
              rawDate: '2026-06-14',
              weight: 100,
              sets: [8, 8],
            },
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

    expect(response.weeks[0].status).toBe('partial');
    expect(response.weeks[1].status).toBe('complete');
    expect(response.weeks[2].status).toBe('not-started');
    expect(response.defaultWeekId).toBe('2026-06-28');
  });

  it('advances past a week left permanently partial by a skipped session once later weeks are underway', async () => {
    const touchedSheet = makeSheet([
      {
        weeks: [
          { displayDate: '6/14', rawDate: '2026-06-14', weight: 100, sets: [8, 8, 8] },
          { displayDate: '6/21', rawDate: '2026-06-21', weight: 100, sets: [8, 8, 8] },
          { displayDate: '6/28', rawDate: '2026-06-28' },
        ],
      },
    ]);
    const skippedSheet = makeSheet([
      {
        weeks: [
          { displayDate: '6/14', rawDate: '2026-06-14' },
          { displayDate: '6/21', rawDate: '2026-06-21', weight: 100, sets: [8, 8, 8] },
          { displayDate: '6/28', rawDate: '2026-06-28' },
        ],
      },
    ]);

    const response = await readTrainingWeeks(
      gatewayFor([touchedSheet, touchedSheet, touchedSheet, skippedSheet])
    );

    expect(response.weeks[0].status).toBe('partial');
    expect(response.weeks[1].status).toBe('complete');
    expect(response.weeks[2].status).toBe('not-started');
    expect(response.defaultWeekId).toBe('2026-06-28');
  });

  it('treats a week as unfinished when even one of its sessions was never started', async () => {
    const touchedSheet = makeSheet([
      {
        weeks: [
          {
            displayDate: '6/14',
            rawDate: '2026-06-14',
            weight: 100,
            sets: [8, 8, 8],
          },
        ],
      },
    ]);
    const untouchedSheet = makeSheet([
      {
        weeks: [{ displayDate: '6/14', rawDate: '2026-06-14' }],
      },
    ]);

    const response = await readTrainingWeeks(
      gatewayFor([touchedSheet, touchedSheet, touchedSheet, untouchedSheet])
    );

    expect(response.weeks[0].sessions.map((session) => session.status)).toEqual(
      ['complete', 'complete', 'complete', 'not-started']
    );
    expect(response.defaultWeekId).toBe('2026-06-14');
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

  it('reports an unreadable-tabs problem when the gateway drops a grid', async () => {
    const sheets = Array.from({ length: 4 }, () => makeSheet([{ weeks: [] }]));
    const inner = gatewayFor(sheets);
    const droppingGateway: SpreadsheetGateway = {
      ...inner,
      listSheetTitles: () => inner.listSheetTitles(),
      readRanges: async (ranges, render) =>
        (await inner.readRanges(ranges, render)).slice(1),
    };

    const error = await readTrainingWeeks(droppingGateway).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SourceSpreadsheetSchemaError);
    expect((error as SourceSpreadsheetSchemaError).problems).toMatchObject([
      { code: 'unreadable-tabs', tab: null, cell: null },
    ]);
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

  it('parses an 8th lift group instead of silently dropping it (regression: trailing exercises like abs vanishing)', async () => {
    const liftNames = [
      'Squat',
      'Bench',
      'Row',
      'Overhead Press',
      'Lat Pulldown',
      'Leg Curl',
      'Face Pull',
      'Cable Crunch',
    ];
    const grid: unknown[][] = [];
    liftNames.forEach((name, groupIndex) => {
      const col = groupIndex * 6;
      grid[0] = grid[0] ?? [];
      grid[1] = grid[1] ?? [];
      grid[2] = grid[2] ?? [];
      grid[3] = grid[3] ?? [];
      grid[4] = grid[4] ?? [];
      grid[0][col] = 'Lift';
      grid[0][col + 1] = name;
      grid[1][col] = 'Progression';
      grid[1][col + 1] = 'Dynamic DP';
      grid[2][col] = 'Sets';
      grid[2][col + 1] = 3;
      grid[3][col] = 'Reps';
      grid[3][col + 1] = '6-8';
      grid[4][col] = 'Cue';
      grid[4][col + 1] = 'Controlled reps';
    });
    grid[5] = ['Week', 'Weight', 1, 2, 3, 4];
    const weekRow: unknown[] = [serial('2026-06-28')];
    liftNames.forEach((_, groupIndex) => {
      const col = groupIndex * 6;
      weekRow[col + 1] = 100 + groupIndex;
      weekRow[col + 2] = 8;
      weekRow[col + 3] = 8;
      weekRow[col + 4] = 7;
    });
    grid[6] = weekRow;
    const formatted = overlayFormatted(grid, [[], [], [], [], [], [], ['6/28']]);

    const sheets = Array.from({ length: 4 }, () => ({ cells: grid, formatted }));
    const response = await readTrainingWeeks(gatewayFor(sheets));

    expect(response.weeks[0].sessions[0].totalLifts).toBe(8);
    expect(
      response.weeks[0].sessions[0].lifts.map((lift) => lift.name)
    ).toEqual(liftNames);
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

  it('completes a Sets-range lift when only the required sets are logged', async () => {
    const sheets = Array.from({ length: 4 }, () =>
      makeSheet([
        {
          setsCell: '2-3',
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
      weight: 100,
      setResults: [8, 8],
    });
    expect(saved.weeks[0].sessions[0].lifts[0]).toMatchObject({
      status: 'complete',
      setResults: ['8', '8', null],
    });
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

describe('problem handling', () => {
  const droppingGateway = (): SpreadsheetGateway => {
    const inner = gatewayFor(Array.from({ length: 4 }, () => makeSheet([{ weeks: [] }])));
    return {
      ...inner,
      listSheetTitles: () => inner.listSheetTitles(),
      readRanges: async (ranges, render) =>
        (await inner.readRanges(ranges, render)).slice(1),
    };
  };
  const goodSheet = () => makeSheet([{ weeks: [{ displayDate: '6/28', rawDate: '2026-06-28' }] }]);
  const brokenGateway = () => {
    const noHeader = { cells: [['Lift', 'Squat']] } as never;
    return gatewayFor([noHeader, goodSheet(), goodSheet(), goodSheet()]);
  };

  it('reports an unreadable tab as a blocking problem in the report', async () => {
    const report = await readTrainingReport(droppingGateway());
    expect(report.ok).toBe(false);
    expect(report.problems).toMatchObject([{ code: 'unreadable-tabs', tab: null, cell: null }]);
  });

  it('refuses a Lift Log write on a broken sheet with a schema error and writes nothing', async () => {
    const gateway = brokenGateway();
    const writeRange = vi.spyOn(gateway, 'writeRange');
    const clearRange = vi.spyOn(gateway, 'clearRange');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const error = await writeLiftLog(gateway, {
      operation: 'clear',
      weekId: '2026-06-28',
      session: 'Upper A',
      liftId: 'test-lift',
      revision: 'x',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SourceSpreadsheetSchemaError);
    expect((error as SourceSpreadsheetSchemaError).message).toBe(FORMAT_MESSAGE);
    expect((error as SourceSpreadsheetSchemaError).problems).toMatchObject([
      { code: 'missing-week-header', tab: 'Upper A' },
    ]);
    expect(writeRange).not.toHaveBeenCalled();
    expect(clearRange).not.toHaveBeenCalled();
  });

  it('gives an unreadable tab the plain-language schema error on read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = await readTrainingWeeks(droppingGateway()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceSpreadsheetSchemaError);
    expect((error as SourceSpreadsheetSchemaError).message).toBe(FORMAT_MESSAGE);
  });

  it('logs problems on a blocked read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await readTrainingWeeks(brokenGateway()).catch(() => undefined);
    expect(warn).toHaveBeenCalledWith('[training] source spreadsheet problems', {
      event: 'training-problems',
      problems: [expect.objectContaining({ code: 'missing-week-header' })],
    });
    warn.mockRestore();
  });

  it('logs problems on a refused write', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeLiftLog(brokenGateway(), {
      operation: 'clear',
      weekId: '2026-06-28',
      session: 'Upper A',
      liftId: 'test-lift',
      revision: 'x',
    }).catch(() => undefined);
    expect(warn).toHaveBeenCalledWith(
      '[training] source spreadsheet problems',
      expect.objectContaining({ event: 'training-problems' })
    );
    warn.mockRestore();
  });

  it('logs non-blocking problems on an ok read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const badSets = makeSheet([
      { setsCell: '9', weeks: [{ displayDate: '6/28', rawDate: '2026-06-28' }] },
    ]);
    const report = await readTrainingReport(
      gatewayFor([goodSheet(), goodSheet(), goodSheet(), badSets])
    );
    expect(report.ok).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[training] source spreadsheet problems',
      expect.objectContaining({ event: 'training-problems' })
    );
    warn.mockRestore();
  });

  it('does not log when there are no problems', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await readTrainingWeeks(
      gatewayFor([goodSheet(), goodSheet(), goodSheet(), goodSheet()])
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('readTrainingReport', () => {
  const goodWeeks = [{ displayDate: '6/28', rawDate: '2026-06-28' }];
  const good = () => makeSheet([{ weeks: goodWeeks }]);
  const four = (overrides: Record<number, ReturnType<typeof makeSheet>> = {}) =>
    Array.from({ length: 4 }, (_, index) => overrides[index] ?? good());
  const problemsOf = (report: { problems: readonly { code: string; tab: string | null; cell: string | null }[] }) =>
    report.problems.map(({ code, tab, cell }) => ({ code, tab, cell }));

  it('reports a clean spreadsheet with discovered sessions and no problems', async () => {
    const report = await readTrainingReport(gatewayFor(four()));
    expect(report).toMatchObject({ ok: true, sessions: DEFAULT_SESSION_TITLES, problems: [] });
  });

  it('reports no Workout Sessions', async () => {
    const report = await readTrainingReport(
      gatewayFor([{ cells: [['Notes']] }], ['Notes'])
    );
    expect(report.ok).toBe(false);
    expect(problemsOf(report)).toEqual([
      { code: 'no-workout-sessions', tab: null, cell: null },
    ]);
  });

  it('ignores a tab with no Lift row', async () => {
    const report = await readTrainingReport(
      gatewayFor([good(), { cells: [['Notes', 'x']] }, good()], ['Upper A', 'Notes', 'Lower A'])
    );
    expect(report).toMatchObject({ ok: true, sessions: ['Upper A', 'Lower A'], problems: [] });
  });

  it('reports a missing Week header with tab and cell, still discovering other tabs', async () => {
    const broken = { cells: [['Lift', 'Squat'], ['Progression', 'x'], ['Sets', 3], ['Reps', '5']] };
    const report = await readTrainingReport(gatewayFor(four({ 1: broken as never })));
    expect(report.ok).toBe(false);
    expect(report.sessions).toEqual(DEFAULT_SESSION_TITLES);
    expect(problemsOf(report)).toEqual([
      { code: 'missing-week-header', tab: 'Lower A', cell: 'A1' },
    ]);
    expect(report.problems[0].message).toContain('Lower A');
  });

  it('reports a missing program field', async () => {
    const broken = {
      cells: [['Lift', 'Squat'], ['Progression', 'x'], ['Reps', '5'], ['Week', 'Weight'], [serial('2026-06-28')]],
      formatted: [['Lift', 'Squat'], ['Progression', 'x'], ['Reps', '5'], ['Week', 'Weight'], ['6/28']],
    };
    const report = await readTrainingReport(gatewayFor(four({ 0: broken })));
    expect(report.ok).toBe(false);
    expect(problemsOf(report)).toEqual([
      { code: 'missing-program-field', tab: 'Upper A', cell: 'A1' },
    ]);
    expect(report.problems[0].message).toContain('Sets');
  });

  it('reports a session with no week rows', async () => {
    const empty = makeSheet([{ weeks: [] }]);
    const report = await readTrainingReport(gatewayFor(four({ 2: empty })));
    expect(problemsOf(report)).toEqual([
      { code: 'no-week-rows', tab: 'Upper B', cell: null },
    ]);
  });

  it('reports an unreadable week date', async () => {
    const sheet = makeSheet([{ weeks: goodWeeks }]);
    sheet.cells[6] = [serial('2026-06-28'), ''];
    sheet.formatted[6] = ['', ''];
    sheet.cells[6][0] = 'oops';
    sheet.formatted[6][0] = '';
    const report = await readTrainingReport(gatewayFor(four({ 0: sheet })));
    expect(problemsOf(report)).toEqual([
      { code: 'unreadable-week-date', tab: 'Upper A', cell: 'A7' },
    ]);
  });

  it('reports an invalid week date', async () => {
    const sheet = makeSheet([
      { weeks: [{ displayDate: '6/28', rawDate: '2026-06-28' }, { displayDate: 'soon', rawDate: '2026-07-05' }] },
    ]);
    const report = await readTrainingReport(gatewayFor(four({ 3: sheet })));
    expect(report.ok).toBe(false);
    expect(problemsOf(report)).toContainEqual({
      code: 'invalid-week-date',
      tab: 'Lower B',
      cell: 'A8',
    });
  });

  it('reports a duplicate week date', async () => {
    const sheet = makeSheet([
      { weeks: [goodWeeks[0], goodWeeks[0]] },
    ]);
    const report = await readTrainingReport(gatewayFor(four({ 0: sheet })));
    expect(problemsOf(report)).toEqual([
      { code: 'duplicate-week-date', tab: 'Upper A', cell: 'A8' },
    ]);
  });

  it('reports mismatched week dates against the first session tab', async () => {
    const other = makeSheet([{ weeks: [{ displayDate: '7/5', rawDate: '2026-07-05' }] }]);
    const report = await readTrainingReport(gatewayFor(four({ 3: other })));
    expect(report.ok).toBe(false);
    expect(problemsOf(report)).toEqual([
      { code: 'week-dates-mismatch', tab: 'Lower B', cell: 'A7' },
    ]);
  });

  it('keeps a bad set count non-blocking: week unavailable, problem reported', async () => {
    const bad = makeSheet([{ setsCell: '3-5', weeks: goodWeeks }]);
    const report = await readTrainingReport(gatewayFor(four({ 1: bad })));
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.trainingWeeks.weeks[0].availability).toBe('unavailable');
    }
    expect(problemsOf(report)).toEqual([
      { code: 'set-count-out-of-range', tab: 'Lower A', cell: 'B3' },
    ]);
  });

  it('reports a missing Rep Target, non-blocking', async () => {
    const bad = makeSheet([{ repTarget: '', weeks: goodWeeks }]);
    const report = await readTrainingReport(gatewayFor(four({ 0: bad })));
    expect(report.ok).toBe(true);
    expect(problemsOf(report)).toEqual([
      { code: 'lift-missing-rep-target', tab: 'Upper A', cell: 'B4' },
    ]);
  });

  it('reports a lift with program fields but no name, non-blocking', async () => {
    const bad = makeSheet([{ liftName: '', weeks: goodWeeks }]);
    const report = await readTrainingReport(gatewayFor(four({ 0: bad })));
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.trainingWeeks.weeks[0].availability).toBe('unavailable');
    }
    expect(problemsOf(report)).toEqual([
      { code: 'lift-missing-name', tab: 'Upper A', cell: 'B1' },
    ]);
  });

  it('collects problems from multiple tabs together', async () => {
    const noHeader = { cells: [['Lift', 'Squat']] };
    const badSets = makeSheet([{ setsCell: 9, weeks: goodWeeks }]);
    const report = await readTrainingReport(
      gatewayFor(four({ 0: noHeader as never, 2: badSets }))
    );
    expect(report.ok).toBe(false);
    expect(problemsOf(report)).toEqual([
      { code: 'missing-week-header', tab: 'Upper A', cell: 'A1' },
      { code: 'set-count-out-of-range', tab: 'Upper B', cell: 'B3' },
    ]);
  });

  it('readTrainingWeeks throws a schema error carrying the problems', async () => {
    const noHeader = { cells: [['Lift', 'Squat']] };
    const error = await readTrainingWeeks(
      gatewayFor(four({ 0: noHeader as never }))
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(SourceSpreadsheetSchemaError);
    expect(error.problems).toMatchObject([{ code: 'missing-week-header', tab: 'Upper A', cell: 'A1' }]);
  });
});
