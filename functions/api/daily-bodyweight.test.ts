import { describe, expect, it } from 'vitest';

import type { BodyTrackingGateway } from '../lib/body-tracking';
import { readBodyweight } from '../lib/body-tracking';
import { handleDailyBodyweightRequest } from './daily-bodyweight';

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

describe('PUT /api/daily-bodyweight', () => {
  it('requires Private Tool Access away from localhost', async () => {
    const response = await handleDailyBodyweightRequest(
      new Request('https://example.com/api/daily-bodyweight', { method: 'PUT' }),
      configuredEnv
    );
    expect(response.status).toBe(401);
  });

  it('rejects unsupported methods', async () => {
    const response = await handleDailyBodyweightRequest(
      new Request('http://localhost/api/daily-bodyweight'),
      configuredEnv
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('PUT');
  });

  it('rejects malformed requests', async () => {
    const cases = [
      { operation: 'save', date: 'not-a-date', weight: 100, revision: 'rev' },
      { operation: 'save', date: '2026-06-29', weight: -5, revision: 'rev' },
      { operation: 'save', date: '2026-06-29', revision: 'rev' },
      { operation: 'clear', date: '2026-06-29' },
    ];
    for (const body of cases) {
      const response = await handleDailyBodyweightRequest(
        jsonRequest(body),
        configuredEnv
      );
      expect(response.status).toBe(400);
    }
  });

  it('returns a conflict when the revision is stale', async () => {
    const gateway = new ValidBodyweightGateway();
    const response = await handleDailyBodyweightRequest(
      jsonRequest({ operation: 'clear', date: '2026-06-29', revision: 'stale' }),
      configuredEnv,
      () => gateway
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });

  it('saves and returns the updated response', async () => {
    const gateway = new ValidBodyweightGateway();
    const initial = await readBodyweight(gateway);
    const entry = initial.entries[0];

    const response = await handleDailyBodyweightRequest(
      jsonRequest({
        operation: 'save',
        date: '2026-06-29',
        weight: 226,
        revision: entry.revision,
      }),
      configuredEnv,
      () => gateway
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { entries: Array<{ date: string; hasValue: boolean }> };
    const updated = body.entries.find((e) => e.date === '2026-06-29');
    expect(updated?.hasValue).toBe(true);
  });
});

class ValidBodyweightGateway implements BodyTrackingGateway {
  private raw: unknown[][];
  private fmt: unknown[][];

  constructor() {
    this.raw = [
      [], [], [], [], [],
      ['Date', 'Weight'],
      [serial('2026-06-29'), ''],
    ];
    this.fmt = [
      [], [], [], [], [],
      ['Date', 'Weight'],
      ['6/29', ''],
    ];
  }

  async readRanges(
    _ranges: readonly string[],
    option: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]> {
    return [option === 'UNFORMATTED_VALUE' ? this.raw : this.fmt];
  }

  async writeRange(
    _sheetName: string,
    range: string,
    values: readonly unknown[]
  ): Promise<void> {
    const match = /B(\d+)/.exec(range);
    if (match) {
      const row = Number(match[1]) - 1;
      values.forEach((value, index) => {
        this.raw[row][1 + index] = value;
        this.fmt[row][1 + index] = String(value);
      });
    }
  }

  async clearRange(_sheetName: string, range: string): Promise<void> {
    const match = /B(\d+)/.exec(range);
    if (match) {
      const row = Number(match[1]) - 1;
      this.raw[row][1] = '';
      this.fmt[row][1] = '';
    }
  }
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/daily-bodyweight', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
