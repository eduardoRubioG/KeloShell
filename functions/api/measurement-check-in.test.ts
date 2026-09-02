import { describe, expect, it } from 'vitest';

import {
  readMeasurements,
  type MeasurementTrackingGateway,
} from '../lib/measurement-tracking';
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
    const gateway = new ValidMeasurementGateway();
    const response = await handleMeasurementCheckInRequest(
      jsonRequest({ date: '2026-01-01', revision: 'stale', values: { waist: 33 } }),
      configuredEnv,
      () => gateway
    );
    expect(response.status).toBe(409);
  });

  it('saves partial fields and returns the updated response', async () => {
    const gateway = new ValidMeasurementGateway();
    const initial = await readMeasurements(gateway);
    const checkIn = initial.checkIns[0];

    const response = await handleMeasurementCheckInRequest(
      jsonRequest({
        date: checkIn.date,
        revision: checkIn.revision,
        values: { waist: 33, chest: 44 },
      }),
      configuredEnv,
      () => gateway
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
  });
});

class ValidMeasurementGateway implements MeasurementTrackingGateway {
  private raw: unknown[][];
  private fmt: unknown[][];

  constructor() {
    this.raw = [
      [],
      [],
      [],
      ['', 'Mandatory', '', '', 'Recommended'],
      ['Month', 'Waist', 'Chest', 'Neck'],
      ['January 1st', '', '', ''],
    ];
    this.fmt = [
      [],
      [],
      [],
      ['', 'Mandatory', '', '', 'Recommended'],
      ['Month', 'Waist', 'Chest', 'Neck'],
      ['January 1st', '', '', ''],
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
    const match = /^([A-Z]+)(\d+)$/.exec(range);
    if (!match) {
      return;
    }
    const columnLetters = match[1];
    const row = Number(match[2]) - 1;
    let column = 0;
    for (const letter of columnLetters) {
      column = column * 26 + (letter.charCodeAt(0) - 64);
    }
    const gOffset = column - 7;
    values.forEach((value, index) => {
      this.raw[row][gOffset + index] = value;
      this.fmt[row][gOffset + index] = String(value);
    });
  }
}

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/measurement-check-in', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
