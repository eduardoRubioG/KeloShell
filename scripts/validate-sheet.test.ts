import { describe, expect, it } from 'vitest';

import { resolveCoachTemplate } from '../functions/coach-templates/registry';
import {
  FakeSpreadsheet,
  trackingTabGrid,
  workoutSessionGrids,
  DEFAULT_SESSION_TITLES,
} from '../functions/testing/fake-spreadsheet';
import {
  parseValidateSheetArgs,
  runValidateSheet,
  USAGE,
} from './validate-sheet-core';

const template = resolveCoachTemplate();

const sessionTabs = () =>
  DEFAULT_SESSION_TITLES.map((title) => ({
    title,
    ...workoutSessionGrids([
      {
        weeks: [
          { displayDate: '1/5', rawDate: '2026-01-05', weight: 100, sets: [8, 8, 8] },
          { displayDate: '1/12', rawDate: '2026-01-12' },
        ],
      },
    ]),
  }));

const measurements = {
  fields: ['Waist', 'Neck'],
  checkIns: [['June 1st', [null, null]]] as [string, (number | null)[]][],
};

describe('validate-sheet', () => {
  it('prints the discovered structure and exits 0 for a clean sheet', async () => {
    const sheet = new FakeSpreadsheet([
      ...sessionTabs(),
      { title: "Tracking '26", ...trackingTabGrid([['2026-06-01', 220], ['2026-06-02', null]], measurements) },
    ]);

    const result = await runValidateSheet(sheet, template, '2026-06-02');

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Workout Sessions (4, in Session Order)');
    expect(result.output.indexOf('Upper A')).toBeLessThan(result.output.indexOf('Lower B'));
    expect(result.output).toContain("1. Tracking '26");
    expect(result.output).toContain("Current Tracking tab for 2026-06-02: Tracking '26");
    expect(result.output).toContain('Problems (0)');
  });

  it('prints every problem with rule code, tab and cell and exits 1', async () => {
    const sheet = new FakeSpreadsheet([
      ...sessionTabs(),
      { title: "Tracking '26", ...trackingTabGrid([['2026-12-31', 224.5]], measurements) },
      { title: "Tracking '27", ...trackingTabGrid([['2026-12-31', 224]], measurements) },
    ]);

    const result = await runValidateSheet(sheet, template, '2027-01-02');

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Current Tracking tab for 2027-01-02: (none)");
    expect(result.output).toContain("[duplicate-tracking-date] tab: Tracking '27, cell: A3");
    expect(result.output).toContain('FAILED');
  });

  it('reports a spreadsheet with no tabs as problems', async () => {
    const result = await runValidateSheet(new FakeSpreadsheet([]), template, '2026-06-02');

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('[no-tracking-tabs]');
  });

  it('never writes to the spreadsheet', async () => {
    const sheet = new FakeSpreadsheet([
      ...sessionTabs(),
      { title: "Tracking '26", ...trackingTabGrid([['2026-06-02', null]], measurements) },
    ]);
    const writes: string[] = [];
    sheet.writeRange = async (...args) => void writes.push(`write ${args[0]}`);
    sheet.clearRange = async (...args) => void writes.push(`clear ${args[0]}`);

    await runValidateSheet(sheet, template, '2026-06-02');

    expect(writes).toEqual([]);
  });

  describe('parseValidateSheetArgs', () => {
    it('takes a spreadsheet ID and an optional date', () => {
      expect(parseValidateSheetArgs(['abc'])).toEqual({ spreadsheetId: 'abc', date: undefined });
      expect(parseValidateSheetArgs(['abc', '2027-01-02'])).toEqual({
        spreadsheetId: 'abc',
        date: '2027-01-02',
      });
    });

    it('rejects a missing ID, extra arguments and malformed dates', () => {
      expect(() => parseValidateSheetArgs([])).toThrow(USAGE);
      expect(() => parseValidateSheetArgs(['abc', '2027-01-02', 'x'])).toThrow(USAGE);
      expect(() => parseValidateSheetArgs(['abc', '1/2/2027'])).toThrow('Invalid date');
      expect(() => parseValidateSheetArgs(['abc', '2027-02-31'])).toThrow('Invalid date');
    });
  });
});
