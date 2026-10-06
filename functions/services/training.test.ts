import { describe, expect, it } from 'vitest';

import { LiftLogConflictError } from '../coach-templates/coach-partner/training';
import { resolveCoachTemplate } from '../coach-templates/registry';
import { SourceSpreadsheetSchemaError } from '../lib/config';
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
