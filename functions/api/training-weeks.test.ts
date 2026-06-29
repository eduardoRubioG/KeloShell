import { describe, expect, it } from 'vitest';

import type { TrainingWeeksGateway } from '../lib/training-weeks';
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
      () => new ValidGateway()
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
});

class ThrowingGateway implements TrainingWeeksGateway {
  async readRanges(): Promise<unknown[][][]> {
    throw new Error('sensitive upstream detail');
  }
}

class SchemaErrorGateway implements TrainingWeeksGateway {
  async readRanges(): Promise<unknown[][][]> {
    return [[], [], [], []];
  }
}

class ValidGateway implements TrainingWeeksGateway {
  async readRanges(
    _ranges: readonly string[],
    option: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]> {
    const grid = [
      ['Lift', 'Test Lift'],
      ['Progression', 'Dynamic DP'],
      ['Sets', 3],
      ['Reps', '6-8'],
      ['Cue', 'Controlled reps'],
      ['Week', 'Weight', 1, 2, 3, 4],
      [46201],
    ];
    const formattedGrid = grid.map((row) => [...row]);
    formattedGrid[6][0] = '6/28';
    const sheet = option === 'UNFORMATTED_VALUE' ? grid : formattedGrid;
    return [sheet, sheet, sheet, sheet];
  }
}
