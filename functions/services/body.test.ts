import { describe, expect, it } from 'vitest';

import { coachPartnerTraining } from '../coach-templates/coach-partner/training';
import { coachPartnerTracking } from '../coach-templates/coach-partner/tracking';
import type { CoachTemplate } from '../coach-templates/types';
import {
  FakeSpreadsheet,
  trackingTabGrid,
  workoutSessionGrids,
} from '../testing/fake-spreadsheet';
import { readBodyweight, readTodayBodyweight, readTrackingReport } from './body';
import { readTrainingReport } from './training';

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
});
