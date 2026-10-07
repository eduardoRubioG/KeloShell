import { describe, expect, it, vi } from 'vitest';

import { coachPartnerTraining } from '../coach-templates/coach-partner/training';
import { coachPartnerTracking } from '../coach-templates/coach-partner/tracking';
import { readMeasurements } from '../services/body';
import { FakeSpreadsheet, trackingTabGrid } from '../testing/fake-spreadsheet';
import { handleMeasurementCheckInRequest } from './measurement-check-in';

const configuredEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  LOCAL_AUTH_BYPASS: 'true',
};

describe('PUT /api/measurement-check-in', () => {
  it('requires Private Tool Access away from localhost', async () => {
    const response = await handleMeasurementCheckInRequest(
      new Request('https://example.com/api/measurement-check-in', { method: 'PUT' }),
      configuredEnv
    );
    expect(response.status).toBe(401);
  });

  it('rejects unsupported methods', async () => {
    const response = await handleMeasurementCheckInRequest(
      new Request('http://localhost/api/measurement-check-in'),
      configuredEnv
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('PUT');
  });

  it('rejects malformed requests', async () => {
    const cases = [
      { date: 'not-a-date', revision: 'rev', values: { waist: 32 } },
      { date: '2026-06-29', revision: 'rev', values: { waist: -1 } },
      { date: '2026-06-29', revision: 'rev', values: {} },
    ];
    for (const body of cases) {
      const response = await handleMeasurementCheckInRequest(jsonRequest(body), configuredEnv);
      expect(response.status).toBe(400);
    }
  });

  it('returns a conflict when the revision is stale', async () => {
    const sheet = fakeSheet();
    const response = await handleMeasurementCheckInRequest(
      jsonRequest({ date: '2026-01-01', revision: 'stale', values: { waist: 33 } }),
      configuredEnv,
      () => sheet
    );
    expect(response.status).toBe(409);
  });

  it('saves partial fields into the tab the check-in was read from', async () => {
    const sheet = fakeSheet();
    const initial = await readMeasurements(sheet, template);
    const checkIn = initial.checkIns.find((entry) => entry.date === '2027-01-01')!;

    const response = await handleMeasurementCheckInRequest(
      jsonRequest({
        date: checkIn.date,
        revision: checkIn.revision,
        values: { waist: 33, chest: 44 },
      }),
      configuredEnv,
      () => sheet
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      checkIns: Array<{ date: string; status: string; values: Record<string, string | null> }>;
    };
    const updated = body.checkIns.find((entry) => entry.date === checkIn.date);
    expect(updated).toMatchObject({
      status: 'partial',
      values: { waist: '33', chest: '44', neck: null },
    });
    const [written] = await sheet.readRanges(["'Tracking ''27'!H3:I3"], 'UNFORMATTED_VALUE');
    expect(written[0]).toEqual([33, 44]);
    const [other] = await sheet.readRanges(["'Tracking ''26'!H3:I3"], 'UNFORMATTED_VALUE');
    expect(other[0] ?? []).toEqual([32, 42]);
  });

  it('returns 422 when the date is duplicated across Tracking tabs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sheet = new FakeSpreadsheet([
      tab("Tracking '26", '2026-12-31'),
      tab("Tracking '27", '2026-12-31'),
    ]);
    const response = await handleMeasurementCheckInRequest(
      jsonRequest({ date: '2026-12-01', revision: 'whatever', values: { waist: 33 } }),
      configuredEnv,
      () => sheet
    );
    expect(response.status).toBe(422);
  });

  it('returns 400 for an unknown measurement field', async () => {
    const sheet = fakeSheet();
    const { checkIns } = await readMeasurements(sheet, template);
    const response = await handleMeasurementCheckInRequest(
      jsonRequest({ date: checkIns[0].date, revision: checkIns[0].revision, values: { hips: 40 } }),
      configuredEnv,
      () => sheet
    );
    expect(response.status).toBe(400);
  });
});

const template = { training: coachPartnerTraining, tracking: coachPartnerTracking };

function tab(title: string, firstDate: string, january: (number | null)[] = [null, null, null]) {
  return {
    title,
    ...trackingTabGrid([[firstDate, 225]], {
      fields: ['Waist', 'Chest', 'Neck'],
      checkIns: [[firstDate.endsWith('-12-31') ? 'December 1st' : 'January 1st', january]],
    }),
  };
}

function fakeSheet(): FakeSpreadsheet {
  return new FakeSpreadsheet([
    tab("Tracking '26", '2026-01-01', [32, 42, 15]),
    tab("Tracking '27", '2027-01-01'),
  ]);
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/measurement-check-in', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
