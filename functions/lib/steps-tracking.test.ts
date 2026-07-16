import { describe, expect, it } from 'vitest';

import {
  StepsConflictError,
  readSteps,
  readLoggedStepsDates,
  writeDailySteps,
  type StepsGateway,
} from './steps-tracking';
import { SourceSpreadsheetSchemaError } from './config';

class MockGateway implements StepsGateway {
  raw: unknown[][];
  fmt: unknown[][];

  constructor(rows: Array<[string, unknown]>) {
    this.raw = [['Date', 'Steps'], ...rows.map(([date, steps]) => [date, steps])];
    this.fmt = [
      ['Date', 'Steps'],
      ...rows.map(([date, steps]) => [date, steps === '' ? '' : String(steps)]),
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
    const match = /(\d+)/.exec(range);
    if (!match) throw new Error(`Unexpected range: ${range}`);
    const row = Number(match[1]) - 1;
    while (this.raw.length <= row) {
      this.raw.push([]);
      this.fmt.push([]);
    }
    if (range.startsWith('A')) {
      this.raw[row] = [values[0], values[1]];
      this.fmt[row] = [String(values[0]), String(values[1])];
    } else {
      this.raw[row][1] = values[0];
      this.fmt[row][1] = String(values[0]);
    }
  }

  async clearRange(_sheetName: string, range: string): Promise<void> {
    const match = /B(\d+)/.exec(range);
    if (!match) throw new Error(`Unexpected range: ${range}`);
    const row = Number(match[1]) - 1;
    this.raw[row][1] = '';
    this.fmt[row][1] = '';
  }
}

describe('readSteps', () => {
  it('returns a rolling window ending on today with logged values merged in', async () => {
    const gateway = new MockGateway([['2026-07-15', 9200]]);

    const response = await readSteps(gateway, '2026-07-16');

    expect(response.tabAvailable).toBe(true);
    expect(response.today).toBe('2026-07-16');
    const logged = response.entries.find((entry) => entry.date === '2026-07-15');
    expect(logged).toMatchObject({ steps: '9200', hasValue: true });
    const todayEntry = response.entries.find((entry) => entry.date === '2026-07-16');
    expect(todayEntry).toMatchObject({ steps: null, hasValue: false });
    // The window always includes today even with no rows for it.
    expect(response.entries.at(-1)?.date).toBe('2026-07-16');
  });

  it('treats zero and blank as no value', async () => {
    const gateway = new MockGateway([
      ['2026-07-15', 0],
      ['2026-07-14', ''],
    ]);

    const response = await readSteps(gateway, '2026-07-16');

    expect(response.entries.find((e) => e.date === '2026-07-15')).toMatchObject({
      hasValue: false,
    });
    expect(response.entries.find((e) => e.date === '2026-07-14')).toMatchObject({
      hasValue: false,
    });
  });

  it('throws when the Date/Steps header row is missing', async () => {
    const gateway = new MockGateway([]);
    gateway.raw[0] = ['Day', 'Count'];

    await expect(readSteps(gateway, '2026-07-16')).rejects.toBeInstanceOf(
      SourceSpreadsheetSchemaError
    );
  });
});

describe('readLoggedStepsDates', () => {
  it('collects only dates with a positive whole-number value', async () => {
    const gateway = new MockGateway([
      ['2026-07-15', 9200],
      ['2026-07-14', 0],
      ['2026-07-13', ''],
    ]);

    const dates = await readLoggedStepsDates(gateway);

    expect([...dates]).toEqual(['2026-07-15']);
  });
});

describe('writeDailySteps', () => {
  it('appends a new row for an unlogged date', async () => {
    const gateway = new MockGateway([]);
    const initial = await readSteps(gateway, '2026-07-16');
    const entry = initial.entries.find((e) => e.date === '2026-07-16')!;

    const response = await writeDailySteps(
      gateway,
      { operation: 'save', date: '2026-07-16', steps: 10500, revision: entry.revision },
      '2026-07-16'
    );

    expect(response.entries.find((e) => e.date === '2026-07-16')).toMatchObject({
      steps: '10500',
      hasValue: true,
    });
  });

  it('updates an existing row for a logged date', async () => {
    const gateway = new MockGateway([['2026-07-16', 8000]]);
    const initial = await readSteps(gateway, '2026-07-16');
    const entry = initial.entries.find((e) => e.date === '2026-07-16')!;

    const response = await writeDailySteps(
      gateway,
      { operation: 'save', date: '2026-07-16', steps: 12000, revision: entry.revision },
      '2026-07-16'
    );

    expect(response.entries.find((e) => e.date === '2026-07-16')).toMatchObject({
      steps: '12000',
      hasValue: true,
    });
  });

  it('clears a logged value', async () => {
    const gateway = new MockGateway([['2026-07-16', 8000]]);
    const initial = await readSteps(gateway, '2026-07-16');
    const entry = initial.entries.find((e) => e.date === '2026-07-16')!;

    const response = await writeDailySteps(
      gateway,
      { operation: 'clear', date: '2026-07-16', revision: entry.revision },
      '2026-07-16'
    );

    expect(response.entries.find((e) => e.date === '2026-07-16')).toMatchObject({
      hasValue: false,
      steps: null,
    });
  });

  it('rejects a stale revision', async () => {
    const gateway = new MockGateway([['2026-07-16', 8000]]);

    await expect(
      writeDailySteps(
        gateway,
        { operation: 'save', date: '2026-07-16', steps: 9000, revision: 'stale' },
        '2026-07-16'
      )
    ).rejects.toBeInstanceOf(StepsConflictError);
  });

  it('rejects a non-positive step count', async () => {
    const gateway = new MockGateway([]);
    const initial = await readSteps(gateway, '2026-07-16');
    const entry = initial.entries.find((e) => e.date === '2026-07-16')!;

    await expect(
      writeDailySteps(
        gateway,
        { operation: 'save', date: '2026-07-16', steps: 0, revision: entry.revision },
        '2026-07-16'
      )
    ).rejects.toBeInstanceOf(TypeError);
  });
});
