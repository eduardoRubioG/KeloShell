import { describe, expect, it } from 'vitest';

import type { TrainingWeeksGateway } from '../lib/training-weeks';
import { handleLiftLogRequest } from './lift-log';

const configuredEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  LOCAL_AUTH_BYPASS: 'true',
};

describe('PUT /api/lift-log', () => {
  it('requires Private Tool Access away from localhost', async () => {
    const response = await handleLiftLogRequest(
      new Request('https://example.com/api/lift-log', { method: 'PUT' }),
      configuredEnv
    );
    expect(response.status).toBe(401);
  });

  it('rejects unsupported methods and malformed logs', async () => {
    const methodResponse = await handleLiftLogRequest(
      new Request('http://localhost/api/lift-log'),
      configuredEnv
    );
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get('allow')).toBe('PUT');

    const invalidResponse = await handleLiftLogRequest(
      jsonRequest({
        operation: 'save',
        weekId: '2026-06-28',
        session: 'Upper A',
        liftId: 'test-lift',
        revision: 'revision',
        weight: 100,
        setResults: [8, null, 7],
      }),
      configuredEnv
    );
    expect(invalidResponse.status).toBe(400);
  });

  it('returns a conflict when the loaded lift revision is stale', async () => {
    const response = await handleLiftLogRequest(
      jsonRequest({
        operation: 'clear',
        weekId: '2026-06-28',
        session: 'Upper A',
        liftId: 'test-lift',
        revision: 'stale',
      }),
      configuredEnv,
      () => new ValidGateway()
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'The Lift Log changed since it was loaded.',
    });
  });
});

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
    const formatted = grid.map((row) => [...row]);
    formatted[6][0] = '6/28';
    const sheet = option === 'UNFORMATTED_VALUE' ? grid : formatted;
    return [sheet, sheet, sheet, sheet];
  }

  async writeRange(): Promise<void> {}
  async clearRange(): Promise<void> {}
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/lift-log', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
