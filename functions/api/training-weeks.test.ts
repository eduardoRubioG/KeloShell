import { describe, expect, it } from 'vitest';

import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';
import {
  FakeSpreadsheet,
  fakeSpreadsheetOf,
  workoutSessionGrids,
} from '../testing/fake-spreadsheet';
import { handleTrainingWeeksRequest } from './training-weeks';

const configuredEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  LOCAL_AUTH_BYPASS: 'true',
};

describe('GET /api/training-weeks', () => {
  it('requires Private Tool Access away from localhost', async () => {
    const response = await handleTrainingWeeksRequest(
      new Request('https://example.com/api/training-weeks'),
      configuredEnv
    );

    expect(response.status).toBe(401);
  });

  it('rejects unsupported methods', async () => {
    const response = await handleTrainingWeeksRequest(
      new Request('http://localhost/api/training-weeks', { method: 'POST' }),
      configuredEnv
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('returns a safe configuration error', async () => {
    const response = await handleTrainingWeeksRequest(
      new Request('http://localhost/api/training-weeks'),
      { LOCAL_AUTH_BYPASS: 'true' }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Source Spreadsheet access is not configured.',
    });
  });

  it('returns a safe upstream error', async () => {
    const response = await handleTrainingWeeksRequest(
      new Request('http://localhost/api/training-weeks'),
      configuredEnv,
      () => new ThrowingGateway()
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'The Source Spreadsheet could not be read.',
    });
  });

  it('returns a safe schema error', async () => {
    const response = await handleTrainingWeeksRequest(
      new Request('http://localhost/api/training-weeks'),
      configuredEnv,
      () => new SchemaErrorGateway()
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'The Source Spreadsheet structure could not be interpreted.',
    });
  });

  it('returns the typed Training Week summary', async () => {
    const response = await handleTrainingWeeksRequest(
      new Request('http://localhost/api/training-weeks'),
      configuredEnv,
      () => sessionsSheet(['Upper A', 'Lower A', 'Upper B', 'Lower B'])
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      defaultWeekId: '2026-06-28',
      weeks: [
        {
          id: '2026-06-28',
          weekNumber: 1,
          availability: 'available',
          status: 'not-started',
          completedSessions: 0,
        },
      ],
    });
  });

  it('discovers a 4-session and a 3-session sheet in tab order', async () => {
    expect(
      await sessionNamesFor(sessionsSheet(['Upper A', 'Lower A', 'Upper B', 'Lower B']))
    ).toEqual(['Upper A', 'Lower A', 'Upper B', 'Lower B']);
    expect(await sessionNamesFor(sessionsSheet(['Full A', 'Full B', 'Full C']))).toEqual([
      'Full A',
      'Full B',
      'Full C',
    ]);
  });

  it('follows tab order as Session Order', async () => {
    const sheet = sessionsSheet(['Upper A', 'Lower A', 'Upper B']);
    sheet.reorder(['Lower A', 'Upper B', 'Upper A']);

    expect(await sessionNamesFor(sheet)).toEqual(['Lower A', 'Upper B', 'Upper A']);
  });

  it('discovers a renamed Workout Session under its new name', async () => {
    const sheet = sessionsSheet(['Upper A', 'Lower A']);
    sheet.rename('Lower A', 'Legs');

    expect(await sessionNamesFor(sheet)).toEqual(['Upper A', 'Legs']);
  });

  it('ignores tabs that are not Workout Sessions', async () => {
    const sheet = new FakeSpreadsheet([
      { title: 'Notes', cells: [['Remember to stretch']] },
      { title: 'Upper A', ...grids() },
      {
        title: "Tracking '26",
        cells: [
          ['Date', 'Weight'],
          [46201, 180],
        ],
      },
      { title: 'Lower A', ...grids() },
    ]);

    expect(await sessionNamesFor(sheet)).toEqual(['Upper A', 'Lower A']);
  });
});

function grids() {
  return workoutSessionGrids([
    {
      weeks: [{ displayDate: '6/28', rawDate: '2026-06-28' }],
    },
  ]);
}

function sessionsSheet(titles: readonly string[]): FakeSpreadsheet {
  return fakeSpreadsheetOf(
    titles.map(() => grids()),
    titles
  );
}

async function sessionNamesFor(gateway: SpreadsheetGateway): Promise<string[]> {
  const response = await handleTrainingWeeksRequest(
    new Request('http://localhost/api/training-weeks'),
    configuredEnv,
    () => gateway
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    weeks: Array<{ sessions: Array<{ name: string }> }>;
  };
  return body.weeks[0].sessions.map((session) => session.name);
}

class ThrowingGateway extends FakeSpreadsheet {
  constructor() {
    super([]);
  }
  async listSheetTitles(): Promise<string[]> {
    throw new Error('sensitive upstream detail');
  }
}

class SchemaErrorGateway extends FakeSpreadsheet {
  constructor() {
    super([{ title: 'Upper A', cells: [['Lift', 'Squat']] }]);
  }
}
