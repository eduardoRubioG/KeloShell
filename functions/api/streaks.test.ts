import { describe, expect, it } from 'vitest';

import type { HabitsGateway } from '../lib/streaks';
import type { BodyTrackingGateway } from '../lib/body-tracking';
import type { TrainingWeeksGateway } from '../lib/training-weeks';
import { SESSION_NAMES } from '../lib/training-weeks';
import { handleStreaksRequest } from './streaks';
import { handleCreatineLogRequest } from './creatine-log';

const configuredEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  KELOSHELL_META_DB_SHEET: 'meta-sheet-id',
  LOCAL_AUTH_BYPASS: 'true',
};

const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86_400_000;
function serial(isoDate: string): number {
  return (Date.parse(`${isoDate}T00:00:00Z`) - SHEETS_EPOCH) / DAY;
}

function makeMinimalSessionGrid(weekIsoDate: string, completedSessions = 0): unknown[][] {
  const weight = completedSessions > 0 ? 100 : '';
  const sets = completedSessions > 0 ? [8, 8, 8] : [];
  return [
    ['Lift', 'Test Lift'],
    ['Progression', 'Standard DP'],
    ['Sets', 3],
    ['Reps', '6-8'],
    ['Cue', ''],
    ['Week', 'Weight', 1, 2, 3, 4],
    [serial(weekIsoDate), weight, ...sets],
  ];
}

function makeMinimalSessionDates(weekIsoDate: string): unknown[][] {
  const d = new Date(`${weekIsoDate}T00:00:00Z`);
  const displayDate = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return [[], [], [], [], [], [], [displayDate]];
}

type CombinedGateway = BodyTrackingGateway & TrainingWeeksGateway;

class ValidMainGateway implements CombinedGateway {
  constructor(
    private readonly weekIsoDate: string = '2026-06-29',
    private readonly completedSessions: number = 4
  ) {}

  async readRanges(
    ranges: readonly string[],
    option: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]> {
    const isBodyweight = ranges.some((r) => r.includes('Tracking'));
    if (isBodyweight) {
      const raw = [
        [],
        ['Date', 'Weight'],
        [serial('2026-06-30'), 225.6],
        [serial('2026-07-01'), 226.0],
      ];
      const fmt = [
        [],
        ['Date', 'Weight'],
        ['6/30', '225.6'],
        ['7/1', '226.0'],
      ];
      return [option === 'UNFORMATTED_VALUE' ? raw : fmt];
    }
    // Training reads: returns 4 identical session grids
    if (option === 'UNFORMATTED_VALUE') {
      return SESSION_NAMES.map(() =>
        makeMinimalSessionGrid(this.weekIsoDate, this.completedSessions)
      );
    }
    return SESSION_NAMES.map(() =>
      makeMinimalSessionDates(this.weekIsoDate)
    );
  }

  async writeRange(): Promise<void> {}
  async clearRange(): Promise<void> {}
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
      () => new ValidMainGateway('2026-06-29', 4),
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
      () => new ValidMainGateway('2026-06-29', 4),
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
      () => new ValidMainGateway(),
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
      () => new ValidMainGateway('2026-06-29', 4),
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
      () => new ValidMainGateway('2026-06-29', 4),
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
