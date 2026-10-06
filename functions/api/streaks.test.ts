import { describe, expect, it } from 'vitest';

import type { HabitsGateway } from '../lib/streaks';
import { BODYWEIGHT_SHEET_NAME } from '../lib/config';
import { FakeSpreadsheet, serialDate, workoutSessionGrids } from '../testing/fake-spreadsheet';
import { handleStreaksRequest } from './streaks';
import { handleCreatineLogRequest } from './creatine-log';

const configuredEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  KELOSHELL_META_DB_SHEET: 'meta-sheet-id',
  LOCAL_AUTH_BYPASS: 'true',
};

const emilyConfiguredEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  EMILY_GOOGLE_SPREADSHEET_ID: 'emily-sheet-id',
  EMILY_META_DB_SHEET: 'emily-meta-sheet-id',
  EMILY_EMAIL: 'emily@example.com',
  LOCAL_AUTH_BYPASS: 'true',
};

const DEFAULT_TITLES = ['Upper A', 'Lower A', 'Upper B', 'Lower B'];

/** Source Spreadsheet with the bodyweight tab plus one Workout Session tab per title. */
function mainSheet(
  weekIsoDate = '2026-06-29',
  completedSessions = 4,
  sessionTitles: readonly string[] = DEFAULT_TITLES
): FakeSpreadsheet {
  const d = new Date(`${weekIsoDate}T00:00:00Z`);
  const displayDate = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  const sessionTabs = sessionTitles.map((title, index) => ({
    title,
    ...workoutSessionGrids([
      {
        weeks: [
          {
            displayDate,
            rawDate: weekIsoDate,
            ...(index < completedSessions ? { weight: 100, sets: [8, 8, 8] } : {}),
          },
        ],
      },
    ]),
  }));
  return new FakeSpreadsheet([
    {
      title: BODYWEIGHT_SHEET_NAME,
      cells: [
        [],
        ['Date', 'Weight'],
        [serialDate('2026-06-30'), 225.6],
        [serialDate('2026-07-01'), 226.0],
      ],
      formatted: [
        [],
        ['Date', 'Weight'],
        ['6/30', '225.6'],
        ['7/1', '226.0'],
      ],
    },
    ...sessionTabs,
  ]);
}

class MockHabitsGateway implements HabitsGateway {
  private rows: unknown[][];

  constructor(dataRows: unknown[][] = []) {
    this.rows = [['Date', 'Habit'], ...dataRows];
  }

  async readRanges(): Promise<unknown[][][]> {
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

describe('GET /api/streaks', () => {
  it('computes workout streaks from Emily’s 3-session sheet', async () => {
    const response = await handleStreaksRequest(
      new Request('http://localhost/api/streaks?as=emily&today=2026-07-01'),
      emilyConfiguredEnv,
      () => mainSheet('2026-06-29', 3, ['Full A', 'Full B', 'Full C']),
      () => new MockHabitsGateway()
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      streaks: Array<{ key: string; count: number; todayComplete: boolean }>;
    };
    const workouts = body.streaks.find((s) => s.key === 'workouts');
    expect(workouts).toMatchObject({ count: 1, todayComplete: true });
  });

  it('requires Private Tool Access away from localhost', async () => {
    const response = await handleStreaksRequest(
      new Request('https://example.com/api/streaks'),
      configuredEnv
    );
    expect(response.status).toBe(401);
  });

  it('rejects unsupported methods', async () => {
    const response = await handleStreaksRequest(
      new Request('http://localhost/api/streaks', { method: 'POST' }),
      configuredEnv
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('returns 500 when KELOSHELL_META_DB_SHEET is not set', async () => {
    const env = { ...configuredEnv, KELOSHELL_META_DB_SHEET: undefined };
    const response = await handleStreaksRequest(
      new Request('http://localhost/api/streaks'),
      env
    );
    expect(response.status).toBe(500);
  });

  it('returns 500 when GOOGLE_SPREADSHEET_ID is not set', async () => {
    const env = { ...configuredEnv, GOOGLE_SPREADSHEET_ID: undefined };
    const response = await handleStreaksRequest(
      new Request('http://localhost/api/streaks'),
      env
    );
    expect(response.status).toBe(500);
  });

  it('returns streaks on a successful GET', async () => {
    const habitsGateway = new MockHabitsGateway([['2026-07-01', 'creatine']]);
    const response = await handleStreaksRequest(
      new Request('http://localhost/api/streaks?today=2026-07-01'),
      configuredEnv,
      () => mainSheet('2026-06-29', 4),
      () => habitsGateway
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      today: string;
      streaks: Array<{ key: string; count: number }>;
      bodyweightPrompt: unknown;
    };
    expect(body.today).toBe('2026-07-01');
    expect(body.streaks).toHaveLength(3);
    const creatineStreak = body.streaks.find((s) => s.key === 'creatine');
    expect(creatineStreak?.count).toBeGreaterThan(0);
  });

  it('uses server date as fallback when today param is missing', async () => {
    const response = await handleStreaksRequest(
      new Request('http://localhost/api/streaks'),
      configuredEnv,
      () => mainSheet('2026-06-29', 4),
      () => new MockHabitsGateway()
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { today: string };
    expect(/^\d{4}-\d{2}-\d{2}$/.test(body.today)).toBe(true);
  });
});

describe('PUT /api/creatine-log', () => {
  it('requires Private Tool Access away from localhost', async () => {
    const response = await handleCreatineLogRequest(
      new Request('https://example.com/api/creatine-log', {
        method: 'PUT',
        body: JSON.stringify({ operation: 'log', date: '2026-07-01' }),
      }),
      configuredEnv
    );
    expect(response.status).toBe(401);
  });

  it('rejects unsupported methods', async () => {
    const response = await handleCreatineLogRequest(
      new Request('http://localhost/api/creatine-log', { method: 'GET' }),
      configuredEnv
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('PUT');
  });

  it('returns 500 when KELOSHELL_META_DB_SHEET is not set', async () => {
    const env = { ...configuredEnv, KELOSHELL_META_DB_SHEET: undefined };
    const response = await handleCreatineLogRequest(
      new Request('http://localhost/api/creatine-log', {
        method: 'PUT',
        body: JSON.stringify({ operation: 'log', date: '2026-07-01' }),
      }),
      env
    );
    expect(response.status).toBe(500);
  });

  it('returns 400 for an invalid request body', async () => {
    const response = await handleCreatineLogRequest(
      new Request('http://localhost/api/creatine-log', {
        method: 'PUT',
        body: JSON.stringify({ operation: 'invalid', date: '2026-07-01' }),
      }),
      configuredEnv,
      () => mainSheet(),
      () => new MockHabitsGateway()
    );
    expect(response.status).toBe(400);
  });

  it('logs creatine and returns fresh streaks', async () => {
    const habitsGateway = new MockHabitsGateway([]);
    const response = await handleCreatineLogRequest(
      new Request('http://localhost/api/creatine-log', {
        method: 'PUT',
        body: JSON.stringify({ operation: 'log', date: '2026-07-01' }),
      }),
      configuredEnv,
      () => mainSheet('2026-06-29', 4),
      () => habitsGateway
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      streaks: Array<{ key: string; count: number; todayComplete: boolean }>;
    };
    const creatine = body.streaks.find((s) => s.key === 'creatine');
    expect(creatine?.todayComplete).toBe(true);
    expect(creatine?.count).toBeGreaterThan(0);
  });

  it('unlogs creatine and returns fresh streaks', async () => {
    const habitsGateway = new MockHabitsGateway([['2026-07-01', 'creatine']]);
    const response = await handleCreatineLogRequest(
      new Request('http://localhost/api/creatine-log', {
        method: 'PUT',
        body: JSON.stringify({ operation: 'unlog', date: '2026-07-01' }),
      }),
      configuredEnv,
      () => mainSheet('2026-06-29', 4),
      () => habitsGateway
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      streaks: Array<{ key: string; count: number; todayComplete: boolean }>;
    };
    const creatine = body.streaks.find((s) => s.key === 'creatine');
    expect(creatine?.todayComplete).toBe(false);
  });
});
