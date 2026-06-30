import { describe, expect, it } from 'vitest';

import type { BodyTrackingGateway } from '../lib/body-tracking';
import { handleBodyweightRequest } from './bodyweight';

const configuredEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  LOCAL_AUTH_BYPASS: 'true',
};

const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86_400_000;
function serial(isoDate: string): number {
  return (Date.parse(`${isoDate}T00:00:00Z`) - SHEETS_EPOCH) / DAY;
}

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
      () => new ValidBodyweightGateway()
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { tabAvailable: boolean; entries: unknown[] };
    expect(body.tabAvailable).toBe(true);
    expect(body.entries.length).toBeGreaterThan(0);
  });
});

class ValidBodyweightGateway implements BodyTrackingGateway {
  async readRanges(
    _ranges: readonly string[],
    option: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]> {
    const raw = [
      [],
      [],
      [],
      [],
      [],
      ['Date', 'Weight'],
      [serial('2026-06-29'), 225.6],
    ];
    const fmt = [
      [],
      [],
      [],
      [],
      [],
      ['Date', 'Weight'],
      ['6/29', '225.6'],
    ];
    return [option === 'UNFORMATTED_VALUE' ? raw : fmt];
  }

  async writeRange(): Promise<void> {}
  async clearRange(): Promise<void> {}
}
