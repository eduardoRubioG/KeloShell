import { describe, expect, it, vi } from 'vitest';

import type { MeasurementsResponse } from '../../src/contracts/measurements';
import { FakeSpreadsheet, trackingTabGrid } from '../testing/fake-spreadsheet';
import { handleMeasurementsRequest } from './measurements';

const configuredEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'sheet-id',
  LOCAL_AUTH_BYPASS: 'true',
};

describe('GET /api/measurements', () => {
  it('requires Private Tool Access away from localhost', async () => {
    const response = await handleMeasurementsRequest(
      new Request('https://example.com/api/measurements'),
      configuredEnv
    );
    expect(response.status).toBe(401);
  });

  it('rejects unsupported methods', async () => {
    const response = await handleMeasurementsRequest(
      new Request('http://localhost/api/measurements', { method: 'PUT' }),
      configuredEnv
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('returns measurement fields and check-ins from every Tracking tab', async () => {
    const response = await handleMeasurementsRequest(
      new Request('http://localhost/api/measurements'),
      configuredEnv,
      () => twoYearSheet()
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as MeasurementsResponse;
    expect(body.tabAvailable).toBe(true);
    expect(body.fields).toEqual([{ id: 'waist', label: 'Waist' }]);
    expect(body.checkIns.map((c) => c.date)).toEqual(['2026-12-01', '2027-01-01']);
  });

  it('answers 422 when a Tracking tab has no Measurement Fields', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await handleMeasurementsRequest(
      new Request('http://localhost/api/measurements'),
      configuredEnv,
      () =>
        new FakeSpreadsheet([
          { title: "Tracking '26", cells: [['Date', 'Weight', '', '', '', '', 'Month']] },
        ])
    );
    expect(response.status).toBe(422);
  });
});

function twoYearSheet(): FakeSpreadsheet {
  const measurements = (label: string) => ({
    fields: ['Waist'],
    checkIns: [[label, [32]]] as [string, number[]][],
  });
  return new FakeSpreadsheet([
    {
      title: "Tracking '26",
      ...trackingTabGrid([['2026-01-01', 225]], measurements('December 1st')),
    },
    {
      title: "Tracking '27",
      ...trackingTabGrid([['2027-01-01', 224]], measurements('January 1st')),
    },
  ]);
}
