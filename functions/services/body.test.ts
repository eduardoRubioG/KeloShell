import { afterEach, describe, expect, it, vi } from 'vitest';

import { coachPartnerTraining } from '../coach-templates/coach-partner/training';
import { coachPartnerTracking } from '../coach-templates/coach-partner/tracking';
import type { CoachTemplate } from '../coach-templates/types';
import {
  FakeSpreadsheet,
  trackingTabGrid,
  serialDate,
  workoutSessionGrids,
} from '../testing/fake-spreadsheet';
import { SourceSpreadsheetSchemaError } from '../lib/format-problems';
import {
  BodyweightConflictError,
  readBodyweight,
  readMeasurements,
  readTodayBodyweight,
  MeasurementCheckInConflictError,
  writeMeasurementCheckIn,
  readTrackingReport,
  writeDailyBodyweight,
} from './body';
import { readTrainingReport } from './training';
import type { DailyBodyweightRequest } from '../../src/contracts/body';

const template: CoachTemplate = {
  training: coachPartnerTraining,
  tracking: coachPartnerTracking,
};

const tab26 = (rows: [string, number | null][]) => ({
  title: "Tracking '26",
  ...trackingTabGrid(rows),
});
const tab27 = (rows: [string, number | null][]) => ({
  title: "Tracking '27",
  ...trackingTabGrid(rows),
});

describe('Body service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('problem logging', () => {
    const duplicated = () =>
      new FakeSpreadsheet([
        tab26([['2026-12-31', 224.5]]),
        tab27([['2026-12-31', 224.0]]),
      ]);

    it('logs the report problems on a read', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await readBodyweight(duplicated(), template, '2026-12-31');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('[body] source spreadsheet problems', {
        event: 'tracking-problems',
        problems: [expect.objectContaining({ code: 'duplicate-tracking-date' })],
      });
    });

    it('logs the problems when a write is refused', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await writeDailyBodyweight(duplicated(), template, {
        operation: 'clear',
        date: '2026-12-31',
        revision: 'x',
      }).catch(() => {});
      expect(warn).toHaveBeenCalledWith('[body] source spreadsheet problems', {
        event: 'tracking-problems',
        problems: [expect.objectContaining({ code: 'duplicate-tracking-date' })],
      });
    });

    it('does not log when there are no problems, even with no row today', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sheet = new FakeSpreadsheet([tab26([['2026-06-30', 225.6]])]);
      await readBodyweight(sheet, template, '2026-07-05');
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("reads a single Tracking tab ('26 only)", async () => {
    const sheet = new FakeSpreadsheet([
      tab26([
        ['2026-06-30', 225.6],
        ['2026-07-01', null],
      ]),
    ]);

    const response = await readBodyweight(sheet, template, '2026-06-30');
    expect(response.tabAvailable).toBe(true);
    expect(response.entries).toMatchObject([
      { date: '2026-06-30', weight: '225.6', hasValue: true },
      { date: '2026-07-01', weight: null, hasValue: false },
    ]);
    expect(await readTodayBodyweight(sheet, template, '2026-06-30')).toMatchObject({
      date: '2026-06-30',
    });
  });

  it('keeps revisions stable for the same date and raw weight', async () => {
    const sheet = new FakeSpreadsheet([tab26([['2026-06-30', 225.6]])]);
    const first = await readBodyweight(sheet, template, '2026-06-30');
    const second = await readBodyweight(sheet, template, '2026-07-01');
    expect(second.entries[0].revision).toBe(first.entries[0].revision);
  });

  it('merges history and picks the current tab across 31 Dec to 1 Jan', async () => {
    const sheet = new FakeSpreadsheet([
      tab27([
        ['2027-01-01', 224.0],
        ['2027-01-02', null],
      ]),
      tab26([
        ['2026-12-30', 225.0],
        ['2026-12-31', 224.5],
      ]),
    ]);

    const response = await readBodyweight(sheet, template, '2026-12-31');
    expect(response.entries.map((e) => e.date)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(await readTodayBodyweight(sheet, template, '2026-12-31')).toMatchObject({
      date: '2026-12-31',
      weight: '224.5',
    });
    expect(await readTodayBodyweight(sheet, template, '2027-01-01')).toMatchObject({
      date: '2027-01-01',
      weight: '224',
    });
  });

  it('reports today as unavailable, without a problem, when no tab has a row for it', async () => {
    const sheet = new FakeSpreadsheet([tab26([['2026-06-30', 225.6]])]);
    const report = await readTrackingReport(sheet, template, '2026-07-05');
    expect(report.todayEntry).toBeNull();
    expect(report.tabAvailable).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it('reports a duplicate date across tabs and leaves it out', async () => {
    const sheet = new FakeSpreadsheet([
      tab26([
        ['2026-12-31', 224.5],
        ['2026-12-30', 225.0],
      ]),
      tab27([
        ['2026-12-31', 224.0],
        ['2027-01-01', 223.0],
      ]),
    ]);

    const report = await readTrackingReport(sheet, template, '2026-12-31');
    expect(report.problems).toMatchObject([
      { code: 'duplicate-tracking-date', tab: "Tracking '27", cell: 'A3' },
    ]);
    expect(report.entries.map((e) => e.date)).toEqual(['2026-12-30', '2027-01-01']);
    expect(report.todayEntry).toBeNull();
  });

  it('reports no Tracking tabs as unavailable with a problem', async () => {
    const sheet = new FakeSpreadsheet([
      { title: 'Notes', cells: [['Date', 'Weight']] },
    ]);
    const response = await readBodyweight(sheet, template, '2026-07-01');
    expect(response).toEqual({ tabAvailable: false, entries: [] });
    const report = await readTrackingReport(sheet, template, '2026-07-01');
    expect(report.problems).toMatchObject([{ code: 'no-tracking-tabs', tab: null }]);
  });

  it('does not treat a Date/Weight tab without a Month header as Tracking', async () => {
    const sheet = new FakeSpreadsheet([
      { title: "Tracking '26", cells: [['Date', 'Weight']] },
    ]);
    expect((await readBodyweight(sheet, template, '2026-07-01')).tabAvailable).toBe(false);
  });

  it('finds a Tracking tab whose Month header is in a different row than Date/Weight', async () => {
    const sheet = new FakeSpreadsheet([
      {
        title: "Tracking '26",
        cells: [
          [],
          ['Date', 'Weight'],
          [serialDate('2026-06-30'), 225.6],
          [],
          ['', '', '', '', '', '', 'Month'],
        ],
      },
    ]);
    const response = await readBodyweight(sheet, template, '2026-06-30');
    expect(response.tabAvailable).toBe(true);
    expect(response.entries).toMatchObject([{ date: '2026-06-30', hasValue: true }]);
  });

  describe('writeDailyBodyweight', () => {
    const cell = (sheet: FakeSpreadsheet, title: string, row: number) =>
      sheet.readRanges([`'${title.replace(/'/g, "''")}'!B${row}`], 'UNFORMATTED_VALUE').then((r) => r[0][0]?.[0]);

    async function revisionOf(sheet: FakeSpreadsheet, date: string, today = date) {
      const { entries } = await readBodyweight(sheet, template, today);
      return entries.find((e) => e.date === date)!.revision;
    }

    it('saves a weight and returns the updated response', async () => {
      const sheet = new FakeSpreadsheet([tab26([['2026-06-29', null]])]);
      const response = await writeDailyBodyweight(sheet, template, {
        operation: 'save',
        date: '2026-06-29',
        weight: 226.5,
        revision: await revisionOf(sheet, '2026-06-29'),
      });
      expect(response.entries[0]).toMatchObject({ hasValue: true, weight: '226.5' });
    });

    it('clears a weight and returns the updated response', async () => {
      const sheet = new FakeSpreadsheet([tab26([['2026-06-29', 225.6]])]);
      const response = await writeDailyBodyweight(sheet, template, {
        operation: 'clear',
        date: '2026-06-29',
        revision: await revisionOf(sheet, '2026-06-29'),
      });
      expect(response.entries[0]).toMatchObject({ hasValue: false, weight: null });
    });

    it('overwrites a formula-error cell on save', async () => {
      const sheet = new FakeSpreadsheet([
        {
          title: "Tracking '26",
          cells: [
            ['Date', 'Weight', '', '', '', '', 'Month'],
            [serialDate('2026-03-03'), '#DIV/0!'],
          ],
        },
      ]);
      const response = await writeDailyBodyweight(sheet, template, {
        operation: 'save',
        date: '2026-03-03',
        weight: 221,
        revision: await revisionOf(sheet, '2026-03-03'),
      });
      expect(response.entries[0]).toMatchObject({ hasValue: true, weight: '221' });
    });

    it('rejects a non-positive weight with a TypeError and writes nothing', async () => {
      const sheet = new FakeSpreadsheet([tab26([['2026-06-29', 225.6]])]);
      await expect(
        writeDailyBodyweight(sheet, template, {
          operation: 'save',
          date: '2026-06-29',
          weight: -1,
          revision: await revisionOf(sheet, '2026-06-29'),
        })
      ).rejects.toBeInstanceOf(TypeError);
      expect(await cell(sheet, "Tracking '26", 3)).toBe(225.6);
    });

    it('routes by date across the 31 Dec to 1 Jan boundary', async () => {
      const sheet = new FakeSpreadsheet([
        tab26([['2026-12-31', null]]),
        tab27([['2027-01-01', null]]),
      ]);
      for (const [date, weight] of [
        ['2026-12-31', 224.5],
        ['2027-01-01', 223.5],
      ] as const) {
        await writeDailyBodyweight(sheet, template, {
          operation: 'save',
          date,
          weight,
          revision: await revisionOf(sheet, date),
        });
      }
      expect(await cell(sheet, "Tracking '26", 3)).toBe(224.5);
      expect(await cell(sheet, "Tracking '27", 3)).toBe(223.5);
    });

    it("writes a past date to the '26 tab while today is in the '27 tab", async () => {
      const sheet = new FakeSpreadsheet([
        tab26([['2026-12-30', 225.0]]),
        tab27([['2027-01-01', null]]),
      ]);
      await writeDailyBodyweight(sheet, template, {
        operation: 'save',
        date: '2026-12-30',
        weight: 226,
        revision: await revisionOf(sheet, '2026-12-30', '2027-01-01'),
      });
      expect(await cell(sheet, "Tracking '26", 3)).toBe(226);
      expect(await cell(sheet, "Tracking '27", 3)).toBe('');
    });

    it('refuses a write to a date present in two tabs, writing nothing', async () => {
      const sheet = new FakeSpreadsheet([
        tab26([['2026-12-31', 224.5]]),
        tab27([['2026-12-31', 224.0]]),
      ]);
      const request: DailyBodyweightRequest = {
        operation: 'save',
        date: '2026-12-31',
        weight: 230,
        revision: 'whatever',
      };
      const error = await writeDailyBodyweight(sheet, template, request).catch((e) => e);
      expect(error).toBeInstanceOf(SourceSpreadsheetSchemaError);
      expect(error.message).toBe('The Source Spreadsheet structure could not be interpreted.');
      expect(error.problems).toMatchObject([{ code: 'duplicate-tracking-date' }]);
      expect(await cell(sheet, "Tracking '26", 3)).toBe(224.5);
      expect(await cell(sheet, "Tracking '27", 3)).toBe(224);
    });

    it('refuses a stale revision, writing nothing', async () => {
      const sheet = new FakeSpreadsheet([tab26([['2026-06-29', 225.6]])]);
      await expect(
        writeDailyBodyweight(sheet, template, {
          operation: 'clear',
          date: '2026-06-29',
          revision: 'stale',
        })
      ).rejects.toBeInstanceOf(BodyweightConflictError);
      expect(await cell(sheet, "Tracking '26", 3)).toBe(225.6);
    });

    it('conflicts when the date is not in any Tracking tab', async () => {
      const sheet = new FakeSpreadsheet([tab26([['2026-06-29', null]])]);
      await expect(
        writeDailyBodyweight(sheet, template, {
          operation: 'clear',
          date: '2026-07-01',
          revision: await revisionOf(sheet, '2026-06-29'),
        })
      ).rejects.toBeInstanceOf(BodyweightConflictError);
    });

    it('fails when the Source Spreadsheet does not confirm the write', async () => {
      const sheet = new FakeSpreadsheet([tab26([['2026-06-29', null]])]);
      sheet.writeRange = async () => {};
      await expect(
        writeDailyBodyweight(sheet, template, {
          operation: 'save',
          date: '2026-06-29',
          weight: 226,
          revision: await revisionOf(sheet, '2026-06-29'),
        })
      ).rejects.toThrow('did not confirm');
    });
  });

  describe('alongside Workout Session tabs', () => {
    const sessionTabs = ['Upper A', 'Lower A', 'Upper B', 'Lower B'].map((title) => ({
      title,
      ...workoutSessionGrids([
        { weeks: [{ displayDate: '6/29', rawDate: '2026-06-29', weight: 100, sets: [8, 8, 8] }] },
      ]),
    }));

    it('keeps the training report ok when tracking has a problem', async () => {
      const sheet = new FakeSpreadsheet([
        ...sessionTabs,
        tab26([['2026-12-31', 224.5]]),
        tab27([['2026-12-31', 224.0]]),
      ]);
      const tracking = await readTrackingReport(sheet, template, '2026-12-31');
      const training = await readTrainingReport(sheet, template);
      expect(tracking.problems.map((p) => p.code)).toEqual(['duplicate-tracking-date']);
      expect(training.ok).toBe(true);
      expect(training.problems).toEqual([]);
    });

    it('keeps the tracking report clean when training is broken', async () => {
      const sheet = new FakeSpreadsheet([
        ...sessionTabs.slice(0, 3),
        { title: 'Lower B', ...workoutSessionGrids([{ weeks: [] }]) },
        tab26([['2026-12-31', 224.5]]),
      ]);
      const tracking = await readTrackingReport(sheet, template, '2026-12-31');
      const training = await readTrainingReport(sheet, template);
      expect(training.problems.length).toBeGreaterThan(0);
      expect(tracking.problems).toEqual([]);
      expect(tracking.todayEntry).toMatchObject({ date: '2026-12-31' });
    });
  });

  describe('readMeasurements', () => {
    const fields = ['Waist', 'Neck'];
    const withCheckIns = (
      title: string,
      rows: [string, number | null][],
      checkIns: [string, (number | null)[]][]
    ) => ({ title, ...trackingTabGrid(rows, { fields, checkIns }) });

    it("lists Measurement Check-Ins from both Tracking tabs, each dated within its own tab's year", async () => {
      const sheet = new FakeSpreadsheet([
        withCheckIns(
          "Tracking '26",
          [['2026-01-01', 225]],
          [
            ['January 1st', [32, 15]],
            ['November 1st', [31, null]],
            ['December 1st', [30.5, 14.5]],
          ]
        ),
        withCheckIns(
          "Tracking '27",
          [['2027-01-01', 224]],
          [
            ['January 1st', [30, 14]],
            ['February 1st', [null, null]],
          ]
        ),
      ]);

      const response = await readMeasurements(sheet, template);

      expect(response.tabAvailable).toBe(true);
      expect(response.fields).toEqual([
        { id: 'waist', label: 'Waist' },
        { id: 'neck', label: 'Neck' },
      ]);
      expect(response.checkIns.map((c) => [c.date, c.label, c.status])).toEqual([
        ['2026-01-01', 'January 1st', 'complete'],
        ['2026-11-01', 'November 1st', 'partial'],
        ['2026-12-01', 'December 1st', 'complete'],
        ['2027-01-01', 'January 1st', 'complete'],
        ['2027-02-01', 'February 1st', 'empty'],
      ]);
      expect(response.checkIns[1].values).toEqual({ waist: '31', neck: null });
      expect(response.unitLabel).toBe('in');
    });

    it('treats formula errors and blank cells as no value', async () => {
      const sheet = new FakeSpreadsheet([
        withCheckIns("Tracking '26", [['2026-03-01', 225]], [['March 1st', ['#DIV/0!' as unknown as number, null]]]),
      ]);
      const response = await readMeasurements(sheet, template);
      expect(response.checkIns[0]).toMatchObject({
        status: 'empty',
        values: { waist: null, neck: null },
      });
    });

    it('keeps the correct year when the tabs are ordered newest first', async () => {
      const sheet = new FakeSpreadsheet([
        withCheckIns("Tracking '27", [['2027-01-01', 224]], [['January 1st', [30, 14]]]),
        withCheckIns("Tracking '26", [['2026-01-01', 225]], [['January 1st', [32, 15]]]),
      ]);
      const response = await readMeasurements(sheet, template);
      expect(response.checkIns.map((c) => c.date)).toEqual(['2026-01-01', '2027-01-01']);
    });

    it('reports a Tracking tab without a Month header as a problem and fails when none is usable', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sheet = new FakeSpreadsheet([
        { title: "Tracking '26", cells: [['Date', 'Weight']] },
      ]);
      const error = await readMeasurements(sheet, template).catch((e) => e);
      expect(error).toBeInstanceOf(SourceSpreadsheetSchemaError);
      expect(error.problems).toMatchObject([
        { code: 'missing-month-header', tab: "Tracking '26" },
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('reports a Tracking tab without Measurement Fields as a problem and fails when none is usable', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sheet = new FakeSpreadsheet([
        {
          title: "Tracking '26",
          cells: [['Date', 'Weight', '', '', '', '', 'Month']],
        },
      ]);
      const error = await readMeasurements(sheet, template).catch((e) => e);
      expect(error).toBeInstanceOf(SourceSpreadsheetSchemaError);
      expect(error.problems).toMatchObject([
        { code: 'missing-measurement-fields', tab: "Tracking '26", cell: 'G1' },
      ]);
    });

    it('still lists the usable tab, logging a problem, when another tab lacks Measurement Fields', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sheet = new FakeSpreadsheet([
        {
          title: "Tracking '26",
          cells: [[], ['Date', 'Weight', '', '', '', '', 'Month']],
        },
        withCheckIns("Tracking '27", [['2027-01-01', 224]], [['January 1st', [30, 14]]]),
      ]);
      const response = await readMeasurements(sheet, template);
      expect(response.checkIns.map((c) => c.date)).toEqual(['2027-01-01']);
      expect(warn).toHaveBeenCalledWith('[body] source spreadsheet problems', {
        event: 'tracking-problems',
        problems: [expect.objectContaining({ code: 'missing-measurement-fields' })],
      });
    });

    it('reports no Tracking tabs as unavailable', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sheet = new FakeSpreadsheet([{ title: 'Notes', cells: [['x']] }]);
      expect(await readMeasurements(sheet, template)).toEqual({
        tabAvailable: false,
        unitLabel: null,
        fields: [],
        checkIns: [],
      });
    });
  });

  describe('writeMeasurementCheckIn', () => {
    const fields = ['Waist', 'Neck'];
    const tab = (
      title: string,
      rows: [string, number | null][],
      checkIns: [string, (number | null)[]][]
    ) => ({ title, ...trackingTabGrid(rows, { fields, checkIns }) });
    const two = () =>
      new FakeSpreadsheet([
        tab("Tracking '26", [['2026-01-01', 225]], [['January 1st', [32, 15]], ['December 1st', [null, null]]]),
        tab("Tracking '27", [['2027-01-01', 224]], [['January 1st', [30, 14]], ['February 1st', [null, null]]]),
      ]);
    const cell = (sheet: FakeSpreadsheet, title: string, ref: string) =>
      sheet
        .readRanges([`'${title.replace(/'/g, "''")}'!${ref}`], 'UNFORMATTED_VALUE')
        .then((r) => r[0][0]?.[0]);
    async function revisionOf(sheet: FakeSpreadsheet, date: string) {
      const { checkIns } = await readMeasurements(sheet, template);
      return checkIns.find((c) => c.date === date)!.revision;
    }

    it("writes a '26 check-in into the '26 tab and a '27 check-in into the '27 tab", async () => {
      const sheet = two();
      await writeMeasurementCheckIn(sheet, template, {
        date: '2026-12-01',
        revision: await revisionOf(sheet, '2026-12-01'),
        values: { waist: 33.5 },
      });
      expect(await cell(sheet, "Tracking '26", 'H4')).toBe(33.5);
      expect(await cell(sheet, "Tracking '27", 'H4')).toBe('');

      const response = await writeMeasurementCheckIn(sheet, template, {
        date: '2027-02-01',
        revision: await revisionOf(sheet, '2027-02-01'),
        values: { waist: 29, neck: 13.5 },
      });
      expect(await cell(sheet, "Tracking '27", 'H4')).toBe(29);
      expect(await cell(sheet, "Tracking '27", 'I4')).toBe(13.5);
      expect(await cell(sheet, "Tracking '26", 'I4')).toBe('');
      const updated = response.checkIns.find((c) => c.date === '2027-02-01');
      expect(updated).toMatchObject({ status: 'complete', values: { waist: '29', neck: '13.5' } });
    });

    it('writes only the requested fields and returns a new revision', async () => {
      const sheet = two();
      const before = await revisionOf(sheet, '2026-12-01');
      const response = await writeMeasurementCheckIn(sheet, template, {
        date: '2026-12-01',
        revision: before,
        values: { waist: 33.5 },
      });
      const updated = response.checkIns.find((c) => c.date === '2026-12-01')!;
      expect(updated).toMatchObject({ status: 'partial', values: { waist: '33.5', neck: null } });
      expect(updated.revision).not.toBe(before);
    });

    it('refuses a stale revision, writing nothing', async () => {
      const sheet = two();
      await expect(
        writeMeasurementCheckIn(sheet, template, {
          date: '2026-12-01',
          revision: 'stale',
          values: { waist: 33 },
        })
      ).rejects.toBeInstanceOf(MeasurementCheckInConflictError);
      expect(await cell(sheet, "Tracking '26", 'H4')).toBe('');
    });

    it('conflicts when the date is not a Measurement Check-In', async () => {
      const sheet = two();
      await expect(
        writeMeasurementCheckIn(sheet, template, {
          date: '2026-05-05',
          revision: 'x',
          values: { waist: 33 },
        })
      ).rejects.toBeInstanceOf(MeasurementCheckInConflictError);
    });

    it('rejects unknown fields and non-positive values with a TypeError, writing nothing', async () => {
      const sheet = two();
      const revision = await revisionOf(sheet, '2026-12-01');
      for (const values of [{ hips: 30 }, { waist: -1 }, {}]) {
        await expect(
          writeMeasurementCheckIn(sheet, template, { date: '2026-12-01', revision, values })
        ).rejects.toBeInstanceOf(TypeError);
      }
      expect(await cell(sheet, "Tracking '26", 'H4')).toBe('');
    });

    it('refuses a date present in two tabs with problems, writing nothing', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sheet = new FakeSpreadsheet([
        tab("Tracking '26", [['2026-12-31', 225]], [['December 1st', [null, null]]]),
        tab("Tracking '27", [['2026-12-31', 224]], [['December 1st', [null, null]]]),
      ]);
      const error = await writeMeasurementCheckIn(sheet, template, {
        date: '2026-12-01',
        revision: await revisionOf(sheet, '2026-12-01'),
        values: { waist: 33 },
      }).catch((e) => e);
      expect(error).toBeInstanceOf(SourceSpreadsheetSchemaError);
      expect(error.problems).toMatchObject([{ code: 'duplicate-measurement-date' }]);
      expect(warn).toHaveBeenCalledWith('[body] source spreadsheet problems', {
        event: 'tracking-problems',
        problems: [expect.objectContaining({ code: 'duplicate-measurement-date' })],
      });
      expect(await cell(sheet, "Tracking '26", 'H3')).toBe('');
      expect(await cell(sheet, "Tracking '27", 'H3')).toBe('');
    });

    it('fails when the Source Spreadsheet does not confirm the write', async () => {
      const sheet = two();
      const revision = await revisionOf(sheet, '2026-12-01');
      sheet.writeRange = async () => {};
      await expect(
        writeMeasurementCheckIn(sheet, template, {
          date: '2026-12-01',
          revision,
          values: { waist: 33 },
        })
      ).rejects.toThrow('did not confirm');
    });
  });
});
