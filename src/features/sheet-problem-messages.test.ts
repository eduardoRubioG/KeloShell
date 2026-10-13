import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchBodyweight, saveDailyBodyweight } from './body/api/bodyweight';
import { fetchMeasurements, saveMeasurementCheckIn } from './body/api/measurements';
import { fetchStreaks, logCreatineHabit } from './training/api/streaks';
import { fetchTrainingWeeks, saveLiftLog } from './training/api/training-weeks';

const MESSAGE = "Your coach's spreadsheet needs a fix.";

function stub422(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: MESSAGE,
          problems: [{ code: 'no-tracking-tabs', tab: null, cell: null, message: 'x' }],
        }),
        { status: 422, headers: { 'content-type': 'application/json' } }
      )
    )
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('a 422 sheet problem reaches the existing error state as the plain message', () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['fetchBodyweight', () => fetchBodyweight()],
    ['saveDailyBodyweight', () => saveDailyBodyweight({} as never)],
    ['fetchMeasurements', () => fetchMeasurements()],
    ['saveMeasurementCheckIn', () => saveMeasurementCheckIn({} as never)],
    ['fetchStreaks', () => fetchStreaks('2026-10-12')],
    ['logCreatineHabit', () => logCreatineHabit({} as never)],
    ['fetchTrainingWeeks', () => fetchTrainingWeeks()],
    ['saveLiftLog', () => saveLiftLog({} as never)],
  ];

  for (const [name, call] of calls) {
    it(name, async () => {
      stub422();
      await expect(call()).rejects.toThrow(MESSAGE);
    });
  }

  it('falls back to a generic message when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })));
    await expect(fetchBodyweight()).rejects.toThrow('Bodyweight data could not be loaded.');
  });
});
