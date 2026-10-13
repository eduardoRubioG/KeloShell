import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiErrorResponse } from '../../src/contracts/training';
import type { HabitsGateway } from '../lib/streaks';
import {
  FakeSpreadsheet,
  trackingTabGrid,
  workoutSessionGrids,
} from '../testing/fake-spreadsheet';
import { handleBodyweightRequest } from './bodyweight';
import { handleCreatineLogRequest } from './creatine-log';
import { handleDailyBodyweightRequest } from './daily-bodyweight';
import { handleLiftLogRequest } from './lift-log';
import { handleMeasurementCheckInRequest } from './measurement-check-in';
import { handleMeasurementsRequest } from './measurements';
import { handleStreaksRequest } from './streaks';
import { handleTrainingWeeksRequest } from './training-weeks';

const env = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  KELOSHELL_META_DB_SHEET: 'meta-sheet-id',
  LOCAL_AUTH_BYPASS: 'true',
};

const SESSIONS = ['Upper A', 'Lower A', 'Upper B', 'Lower B'];

const sessionTabs = () =>
  SESSIONS.map((title) => ({
    title,
    ...workoutSessionGrids([
      { weeks: [{ displayDate: '6/29', rawDate: '2026-06-29', weight: 100, sets: [8, 8, 8] }] },
    ]),
  }));

const trackingTab = () => ({
  title: "Tracking '26",
  ...trackingTabGrid(
    [
      ['2026-06-30', 225.6],
      ['2026-07-01', 226],
    ],
    { fields: ['Waist'], checkIns: [['June 30th', [32]]] }
  ),
});

/** A Workout Session tab with a `Lift` label but no `Week` header. */
const brokenSessionTab = () => ({ title: 'Upper A', cells: [['Lift', 'Squat']] });

/** Tracking intact, Workout Session tab broken. */
const brokenTraining = () =>
  new FakeSpreadsheet([trackingTab(), brokenSessionTab(), ...sessionTabs().slice(1)]);

/** Workout Sessions intact, no Tracking tab. */
const brokenTracking = () => new FakeSpreadsheet(sessionTabs());

const healthy = () => new FakeSpreadsheet([trackingTab(), ...sessionTabs()]);

const habits = {
  async readRanges() {
    return [[['Date', 'Habit']]];
  },
  async writeRange() {},
} as unknown as HabitsGateway;

const put = (url: string, body: unknown) =>
  new Request(`http://localhost/api/${url}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const get = (url: string) => new Request(`http://localhost/api/${url}`);

type Call = (sheet: FakeSpreadsheet) => Promise<Response>;

const trainingEndpoints: Record<string, Call> = {
  'training-weeks': (s) => handleTrainingWeeksRequest(get('training-weeks'), env, () => s),
  'lift-log': (s) =>
    handleLiftLogRequest(
      put('lift-log', {
        operation: 'clear',
        weekId: '2026-06-29',
        session: 'Upper A',
        liftId: 'x',
        revision: 'x',
      }),
      env,
      () => s
    ),
};

const trackingEndpoints: Record<string, Call> = {
  bodyweight: (s) => handleBodyweightRequest(get('bodyweight'), env, () => s),
  measurements: (s) => handleMeasurementsRequest(get('measurements'), env, () => s),
  'daily-bodyweight': (s) =>
    handleDailyBodyweightRequest(
      put('daily-bodyweight', {
        operation: 'save',
        date: '2026-07-01',
        weight: 227,
        revision: 'x',
      }),
      env,
      () => s
    ),
  'measurement-check-in': (s) =>
    handleMeasurementCheckInRequest(
      put('measurement-check-in', {
        date: '2026-06-30',
        revision: 'x',
        values: { waist: 33 },
      }),
      env,
      () => s
    ),
};

// Streaks and the creatine log compute streaks from both sections.
const bothSections: Record<string, Call> = {
  streaks: (s) => handleStreaksRequest(get('streaks'), env, () => s, () => habits),
  'creatine-log': (s) =>
    handleCreatineLogRequest(
      put('creatine-log', { operation: 'log', date: '2026-07-01' }),
      env,
      () => s,
      () => habits
    ),
};

describe('Source Spreadsheet problems', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(Object.keys(trainingEndpoints))(
    '%s answers 422 with problems when a Workout Session tab is broken',
    async (name) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const response = await trainingEndpoints[name](brokenTraining());
      expect(response.status).toBe(422);
      const body = (await response.json()) as ApiErrorResponse;
      expect(body.error).toBe("Your coach's spreadsheet needs a fix.");
      expect(body.problems).toEqual([
        expect.objectContaining({
          code: 'missing-week-header',
          tab: 'Upper A',
          cell: expect.any(String),
          message: expect.any(String),
        }),
      ]);
      expect(warn).toHaveBeenCalledWith(
        '[training] source spreadsheet problems',
        expect.objectContaining({
          problems: [expect.objectContaining({ code: 'missing-week-header' })],
        })
      );
    }
  );

  it.each(Object.keys(trackingEndpoints))(
    '%s answers 422 with problems when there is no Tracking tab',
    async (name) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const response = await trackingEndpoints[name](brokenTracking());
      expect(response.status).toBe(422);
      const body = (await response.json()) as ApiErrorResponse;
      expect(body.error).toBe("Your coach's spreadsheet needs a fix.");
      expect(body.problems).toEqual([
        expect.objectContaining({ code: 'no-tracking-tabs', tab: null, cell: null }),
      ]);
      expect(warn).toHaveBeenCalledWith(
        '[body] source spreadsheet problems',
        expect.objectContaining({
          problems: [expect.objectContaining({ code: 'no-tracking-tabs' })],
        })
      );
    }
  );

  it('keeps Training Weeks at 200 when only the Tracking section is broken', async () => {
    expect((await trainingEndpoints['training-weeks'](brokenTracking())).status).toBe(200);
  });

  it('does not answer 422 to a Lift Log when only the Tracking section is broken', async () => {
    // The stale revision is a 409; what matters is that no Tracking problem leaks in.
    expect((await trainingEndpoints['lift-log'](brokenTracking())).status).toBe(409);
  });

  it.each(['bodyweight', 'measurements'])(
    'keeps %s at 200 when only the Workout Session section is broken',
    async (name) => {
      expect((await trackingEndpoints[name](brokenTraining())).status).toBe(200);
    }
  );

  it.each(['daily-bodyweight', 'measurement-check-in'])(
    'does not answer 422 to %s when only the Workout Session section is broken',
    async (name) => {
      // The stale revision is a 409; what matters is that no Training problem leaks in.
      expect((await trackingEndpoints[name](brokenTraining())).status).toBe(409);
    }
  );

  it.each(Object.keys(bothSections))(
    '%s answers 422 when either section is broken',
    async (name) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect((await bothSections[name](brokenTracking())).status).toBe(422);
      expect((await bothSections[name](brokenTraining())).status).toBe(422);
    }
  );

  it('answers 200 on a healthy Source Spreadsheet', async () => {
    for (const call of [
      trainingEndpoints['training-weeks'],
      trackingEndpoints.bodyweight,
      trackingEndpoints.measurements,
      bothSections.streaks,
    ]) {
      expect((await call(healthy())).status).toBe(200);
    }
  });
});
