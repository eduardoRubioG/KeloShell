import { describe, expect, it } from 'vitest';

import { FakeSpreadsheet, trackingTabGrid } from '../testing/fake-spreadsheet';
import { handleBodyweightRequest } from './bodyweight';

const configuredEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  LOCAL_AUTH_BYPASS: 'true',
};

describe('GET /api/bodyweight', () => {
  it('requires Private Tool Access away from localhost', async () => {
    const response = await handleBodyweightRequest(
      new Request('https://example.com/api/bodyweight'),
      configuredEnv
    );
    expect(response.status).toBe(401);
  });

  it('rejects unsupported methods', async () => {
    const response = await handleBodyweightRequest(
      new Request('http://localhost/api/bodyweight', { method: 'POST' }),
      configuredEnv
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('returns bodyweight entries on success', async () => {
    const response = await handleBodyweightRequest(
      new Request('http://localhost/api/bodyweight'),
      configuredEnv,
      () =>
        new FakeSpreadsheet([
          {
            title: "Tracking '26",
            ...trackingTabGrid([['2026-06-29', 225.6]]),
          },
          {
            title: "Tracking '27",
            ...trackingTabGrid([['2027-01-01', 224.0]]),
          },
        ])
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { tabAvailable: boolean; entries: unknown[] };
    expect(body.tabAvailable).toBe(true);
    expect(body.entries.map((e) => (e as { date: string }).date)).toEqual([
      '2026-06-29',
      '2027-01-01',
    ]);
  });
});
