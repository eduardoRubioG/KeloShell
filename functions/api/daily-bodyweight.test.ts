import { describe, expect, it } from 'vitest';

import { FakeSpreadsheet, trackingTabGrid } from '../testing/fake-spreadsheet';
import { coachPartnerTraining } from '../coach-templates/coach-partner/training';
import { coachPartnerTracking } from '../coach-templates/coach-partner/tracking';
import { readBodyweight } from '../services/body';
import { handleDailyBodyweightRequest } from './daily-bodyweight';

const configuredEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  LOCAL_AUTH_BYPASS: 'true',
};

const template = { training: coachPartnerTraining, tracking: coachPartnerTracking };

const tab = (title: string, rows: [string, number | null][]) => ({
  title,
  ...trackingTabGrid(rows),
});

async function revisionOf(sheet: FakeSpreadsheet, date: string): Promise<string> {
  const { entries } = await readBodyweight(sheet, template, date);
  return entries.find((e) => e.date === date)!.revision;
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
    const sheet = new FakeSpreadsheet([tab("Tracking '26", [['2026-06-29', null]])]);
    const response = await handleDailyBodyweightRequest(
      jsonRequest({ operation: 'clear', date: '2026-06-29', revision: 'stale' }),
      configuredEnv,
      () => sheet
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });

  it('saves into the Tracking tab holding the date and returns the updated response', async () => {
    const sheet = new FakeSpreadsheet([
      tab("Tracking '26", [['2026-12-31', null]]),
      tab("Tracking '27", [['2027-01-01', null]]),
    ]);
    const response = await handleDailyBodyweightRequest(
      jsonRequest({
        operation: 'save',
        date: '2027-01-01',
        weight: 226,
        revision: await revisionOf(sheet, '2027-01-01'),
      }),
      configuredEnv,
      () => sheet
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: Array<{ date: string; hasValue: boolean }>;
    };
    expect(body.entries.find((e) => e.date === '2027-01-01')?.hasValue).toBe(true);
    const [rows26, rows27] = await Promise.all([
      sheet.readRanges(["'Tracking ''26'!B3"], 'UNFORMATTED_VALUE'),
      sheet.readRanges(["'Tracking ''27'!B3"], 'UNFORMATTED_VALUE'),
    ]);
    expect(rows26[0][0][0]).toBe('');
    expect(rows27[0][0][0]).toBe(226);
  });

  it('returns 422 when the date is duplicated across Tracking tabs', async () => {
    const sheet = new FakeSpreadsheet([
      tab("Tracking '26", [['2026-12-31', 224.5]]),
      tab("Tracking '27", [['2026-12-31', 224.0]]),
    ]);
    const response = await handleDailyBodyweightRequest(
      jsonRequest({ operation: 'save', date: '2026-12-31', weight: 230, revision: 'rev' }),
      configuredEnv,
      () => sheet
    );
    expect(response.status).toBe(422);
  });
});

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/daily-bodyweight', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
