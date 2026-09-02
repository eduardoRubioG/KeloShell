import { describe, expect, it } from 'vitest';

import {
  deriveCheckInStatus,
  readMeasurements,
  saveMeasurementCheckIn,
  type MeasurementTrackingGateway,
} from './measurement-tracking';
import { SourceSpreadsheetSchemaError } from './config';

class MockGateway implements MeasurementTrackingGateway {
  constructor(
    private readonly raw: unknown[][],
    private readonly fmt: unknown[][]
  ) {}

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

function makeMeasurementGateway(
  fields: string[],
  dates: string[],
  valuesByDate: Record<string, (number | string | null)[]>
): MockGateway {
  const raw: unknown[][] = [
    [],
    [],
    [],
    ['', 'Mandatory', '', '', 'Recommended'],
    ['Month', ...fields],
  ];
  const fmt: unknown[][] = [
    [],
    [],
    [],
    ['', 'Mandatory', '', '', 'Recommended'],
    ['Month', ...fields],
  ];

  for (const date of dates) {
    const rowValues = valuesByDate[date] ?? fields.map(() => '');
    raw.push([date, ...rowValues]);
    fmt.push([date, ...rowValues.map((value) => (value === null ? '' : String(value)))]);
  }

  return new MockGateway(raw, fmt);
}

describe('readMeasurements', () => {
  it('reads dynamic fields, anchored dates, values, status, and revision', async () => {
    const gateway = makeMeasurementGateway(
      ['BW', 'Waist', 'Neck'],
      ['January 1st', 'February 1st'],
      {
        'January 1st': [180, 32, 15],
        'February 1st': [null, 32.5, null],
      }
    );

    const response = await readMeasurements(gateway);

    expect(response.tabAvailable).toBe(true);
    expect(response.unitLabel).toBe('in');
    expect(response.fields).toEqual([
      { id: 'bw', label: 'BW' },
      { id: 'waist', label: 'Waist' },
      { id: 'neck', label: 'Neck' },
    ]);
    expect(response.checkIns).toHaveLength(2);
    expect(response.checkIns[0]).toMatchObject({
      label: 'January 1st',
      status: 'complete',
      values: { bw: '180', waist: '32', neck: '15' },
    });
    expect(response.checkIns[0].date.endsWith('-01-01')).toBe(true);
    expect(response.checkIns[1]).toMatchObject({
      status: 'partial',
      values: { bw: null, waist: '32.5', neck: null },
    });
    expect(typeof response.checkIns[0].revision).toBe('string');
  });

  it('treats formula errors and blank cells as no value', async () => {
    const gateway = makeMeasurementGateway(['Waist'], ['March 1st'], {
      'March 1st': ['#DIV/0!'],
    });

    const response = await readMeasurements(gateway);

    expect(response.checkIns[0]).toMatchObject({
      status: 'empty',
      values: { waist: null },
    });
  });

  it('throws when the Month header row is not found', async () => {
    const gateway = new MockGateway([['Not', 'A', 'Header']], [['Not', 'A', 'Header']]);

    await expect(readMeasurements(gateway)).rejects.toBeInstanceOf(
      SourceSpreadsheetSchemaError
    );
  });
});

describe('deriveCheckInStatus', () => {
  const fields = [{ id: 'waist' }, { id: 'neck' }];

  it('returns empty, partial, and complete statuses', () => {
    expect(deriveCheckInStatus({ waist: null, neck: null }, fields)).toBe('empty');
    expect(deriveCheckInStatus({ waist: '32', neck: null }, fields)).toBe('partial');
    expect(deriveCheckInStatus({ waist: '32', neck: '15' }, fields)).toBe('complete');
  });
});

describe('saveMeasurementCheckIn', () => {
  it('writes only requested fields and leaves others unchanged', async () => {
    const gateway = makeMeasurementGateway(
      ['Waist', 'Chest', 'Neck'],
      ['January 1st', 'February 1st'],
      {
        'January 1st': [32, 42, 15],
        'February 1st': [null, null, null],
      }
    );

    const initial = await readMeasurements(gateway);
    const target = initial.checkIns.find((checkIn) => checkIn.status === 'empty');
    expect(target).toBeDefined();

    const response = await saveMeasurementCheckIn(gateway, {
      date: target!.date,
      revision: target!.revision,
      values: { waist: 33.5, chest: 43 },
    });

    const updated = response.checkIns.find((checkIn) => checkIn.date === target!.date);
    expect(updated).toMatchObject({
      status: 'partial',
      values: { waist: '33.5', chest: '43', neck: null },
    });
    expect(updated?.revision).not.toBe(target!.revision);
  });

  it('returns a conflict when the revision is stale', async () => {
    const gateway = makeMeasurementGateway(['Waist'], ['March 1st'], {
      'March 1st': [32],
    });
    const initial = await readMeasurements(gateway);
    const checkIn = initial.checkIns[0];

    await expect(
      saveMeasurementCheckIn(gateway, {
        date: checkIn.date,
        revision: 'stale',
        values: { waist: 33 },
      })
    ).rejects.toMatchObject({ name: 'MeasurementCheckInConflictError' });
  });
});
