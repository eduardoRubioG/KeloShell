import { describe, expect, it } from 'vitest';

import type { MeasurementTrackingGateway } from '../lib/measurement-tracking';
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

  it('returns measurement fields and check-ins on success', async () => {
    const response = await handleMeasurementsRequest(
      new Request('http://localhost/api/measurements'),
      configuredEnv,
      () => new ValidMeasurementsGateway()
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tabAvailable: boolean;
      fields: unknown[];
      checkIns: unknown[];
    };
    expect(body.tabAvailable).toBe(true);
    expect(body.fields.length).toBeGreaterThan(0);
    expect(body.checkIns.length).toBeGreaterThan(0);
  });
});

class ValidMeasurementsGateway implements MeasurementTrackingGateway {
  async readRanges(
    _ranges: readonly string[],
    option: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]> {
    const raw = [
      [],
      [],
      [],
      ['', 'Mandatory', '', '', 'Recommended'],
      ['Month', 'Waist', 'Neck'],
      ['January 1st', 32, 15],
    ];
    const fmt = [
      [],
      [],
      [],
      ['', 'Mandatory', '', '', 'Recommended'],
      ['Month', 'Waist', 'Neck'],
      ['January 1st', '32', '15'],
    ];
    return [option === 'UNFORMATTED_VALUE' ? raw : fmt];
  }
}
