import { describe, expect, it } from 'vitest';

import {
  BodyweightConflictError,
  readBodyweight,
  writeDailyBodyweight,
  type BodyTrackingGateway,
} from './body-tracking';
import { SourceSpreadsheetSchemaError } from './config';

const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86_400_000;

function serial(isoDate: string): number {
  return (Date.parse(`${isoDate}T00:00:00Z`) - SHEETS_EPOCH) / DAY;
}

class MockGateway implements BodyTrackingGateway {
  private raw: unknown[][];
  private fmt: unknown[][];

  constructor(raw: unknown[][], fmt: unknown[][]) {
    this.raw = raw;
    this.fmt = fmt;
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
    const row = parseRow(range);
    values.forEach((value, index) => {
      this.raw[row][1 + index] = value;
      this.fmt[row][1 + index] = String(value);
    });
  }

  async clearRange(_sheetName: string, range: string): Promise<void> {
    const row = parseRow(range);
    this.raw[row][1] = '';
    this.fmt[row][1] = '';
  }
}

function parseRow(range: string): number {
  const match = /B(\d+)/.exec(range);
  if (!match) {
    throw new Error(`Unexpected range: ${range}`);
  }
  return Number(match[1]) - 1;
}

interface EntryFixture {
  isoDate: string;
  rawWeight?: unknown;
  fmtWeight?: string;
}

function makeGateway(entries: EntryFixture[]): MockGateway {
  const raw: unknown[][] = [[], [], [], [], [], ['Date', 'Weight']];
  const fmt: unknown[][] = [[], [], [], [], [], ['Date', 'Weight']];
  for (const entry of entries) {
    const [, month, day] = entry.isoDate.split('-');
    raw.push([serial(entry.isoDate), entry.rawWeight ?? '']);
    fmt.push([
      `${Number(month)}/${Number(day)}`,
      entry.fmtWeight !== undefined
        ? entry.fmtWeight
        : entry.rawWeight !== undefined
          ? String(entry.rawWeight)
          : '',
    ]);
  }
  return new MockGateway(raw, fmt);
}

describe('readBodyweight', () => {
  it('reads entries with date, hasValue, weight display, and revision', async () => {
    const gateway = makeGateway([
      { isoDate: '2026-06-29', rawWeight: 225.6, fmtWeight: '225.6' },
      { isoDate: '2026-06-30' },
    ]);

    const response = await readBodyweight(gateway);

    expect(response.tabAvailable).toBe(true);
    expect(response.entries).toHaveLength(2);
    expect(response.entries[0]).toMatchObject({
      date: '2026-06-29',
      weight: '225.6',
      hasValue: true,
    });
    expect(typeof response.entries[0].revision).toBe('string');
    expect(response.entries[0].revision.length).toBeGreaterThan(0);

    expect(response.entries[1]).toMatchObject({
      date: '2026-06-30',
      weight: null,
      hasValue: false,
    });
  });

  it('treats formula errors and blank cells as no value', async () => {
    const gateway = makeGateway([
      { isoDate: '2026-03-03', rawWeight: '#DIV/0!', fmtWeight: '#DIV/0!' },
      { isoDate: '2026-03-04', rawWeight: '', fmtWeight: '' },
      { isoDate: '2026-03-05', rawWeight: 0, fmtWeight: '0' },
    ]);

    const response = await readBodyweight(gateway);

    expect(response.entries[0]).toMatchObject({ hasValue: false, weight: null });
    expect(response.entries[1]).toMatchObject({ hasValue: false, weight: null });
    expect(response.entries[2]).toMatchObject({ hasValue: false, weight: null });
  });

  it('produces different revisions for different raw cell values', async () => {
    const gateway = makeGateway([
      { isoDate: '2026-06-28', rawWeight: 220 },
      { isoDate: '2026-06-29', rawWeight: 225.6 },
    ]);

    const response = await readBodyweight(gateway);

    expect(response.entries[0].revision).not.toBe(response.entries[1].revision);
  });

  it('throws when Date/Weight header row is not found', async () => {
    const raw = [['Not', 'A', 'Header'], [serial('2026-06-29'), 225.6]];
    const fmt = [['Not', 'A', 'Header'], ['6/29', '225.6']];
    const gateway = new MockGateway(raw, fmt);

    await expect(readBodyweight(gateway)).rejects.toBeInstanceOf(
      SourceSpreadsheetSchemaError
    );
  });
});

describe('writeDailyBodyweight', () => {
  it('saves a bodyweight entry and returns the updated response', async () => {
    const gateway = makeGateway([
      { isoDate: '2026-06-29' },
    ]);
    const initial = await readBodyweight(gateway);
    const entry = initial.entries[0];

    const response = await writeDailyBodyweight(gateway, {
      operation: 'save',
      date: '2026-06-29',
      weight: 226.5,
      revision: entry.revision,
    });

    const updated = response.entries.find((e) => e.date === '2026-06-29');
    expect(updated).toMatchObject({ hasValue: true, weight: '226.5' });
  });

  it('clears a bodyweight entry and returns the updated response', async () => {
    const gateway = makeGateway([
      { isoDate: '2026-06-29', rawWeight: 225.6, fmtWeight: '225.6' },
    ]);
    const initial = await readBodyweight(gateway);
    const entry = initial.entries[0];

    const response = await writeDailyBodyweight(gateway, {
      operation: 'clear',
      date: '2026-06-29',
      revision: entry.revision,
    });

    const updated = response.entries.find((e) => e.date === '2026-06-29');
    expect(updated).toMatchObject({ hasValue: false, weight: null });
  });

  it('throws a conflict error when the revision is stale', async () => {
    const gateway = makeGateway([{ isoDate: '2026-06-29' }]);

    await expect(
      writeDailyBodyweight(gateway, {
        operation: 'clear',
        date: '2026-06-29',
        revision: 'stale',
      })
    ).rejects.toBeInstanceOf(BodyweightConflictError);
  });

  it('throws a conflict error when the date is not in the spreadsheet', async () => {
    const gateway = makeGateway([{ isoDate: '2026-06-29' }]);
    const initial = await readBodyweight(gateway);

    await expect(
      writeDailyBodyweight(gateway, {
        operation: 'clear',
        date: '2026-07-01',
        revision: initial.entries[0].revision,
      })
    ).rejects.toBeInstanceOf(BodyweightConflictError);
  });

  it('overwrites a formula cell on save', async () => {
    const gateway = makeGateway([
      { isoDate: '2026-03-03', rawWeight: '#DIV/0!', fmtWeight: '#DIV/0!' },
    ]);
    const initial = await readBodyweight(gateway);
    const entry = initial.entries[0];

    const response = await writeDailyBodyweight(gateway, {
      operation: 'save',
      date: '2026-03-03',
      weight: 221,
      revision: entry.revision,
    });

    expect(response.entries[0]).toMatchObject({ hasValue: true, weight: '221' });
  });
});
