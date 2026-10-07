import { afterEach, describe, expect, it, vi } from 'vitest';

import { coachPartnerTraining } from '../coach-templates/coach-partner/training';
import { coachPartnerTracking } from '../coach-templates/coach-partner/tracking';
import type { CoachTemplate } from '../coach-templates/types';
import { FakeSpreadsheet, trackingTabGrid } from '../testing/fake-spreadsheet';
import { evaluateTrackingReminders, reminderNotification } from './reminders';

const template: CoachTemplate = {
  training: coachPartnerTraining,
  tracking: coachPartnerTracking,
};

const FIELDS = ['Waist', 'Neck'];

function sheetOf(
  title: string,
  rows: [string, number | null][],
  checkIns: [string, (number | null)[]][] = []
): FakeSpreadsheet {
  return new FakeSpreadsheet([
    { title, ...trackingTabGrid(rows, { fields: FIELDS, checkIns }) },
  ]);
}

describe('Reminders service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('evaluateTrackingReminders', () => {
    it('returns both reminders when today has a blank weight and a Measurement Check-In', async () => {
      const sheet = sheetOf(
        "Tracking '27",
        [['2027-07-01', null]],
        [['June 15th', [null, null]], ['July 1st', [null, null]]]
      );

      expect(await evaluateTrackingReminders(sheet, template, '2027-07-01')).toEqual({
        kinds: ['bodyweight', 'measurement'],
        trackingProblem: false,
      });
    });

    it('does not remind about bodyweight when today already has a positive weight', async () => {
      const sheet = sheetOf(
        "Tracking '27",
        [['2027-07-01', 225.4]],
        [['July 1st', [null, null]]]
      );

      expect(await evaluateTrackingReminders(sheet, template, '2027-07-01')).toEqual({
        kinds: ['measurement'],
        trackingProblem: false,
      });
    });

    it('creates no reminders when no tab has a row for today', async () => {
      const sheet = sheetOf(
        "Tracking '27",
        [['2027-06-30', null]],
        [['June 15th', [null, null]]]
      );

      expect(await evaluateTrackingReminders(sheet, template, '2027-07-01')).toEqual({
        kinds: [],
        trackingProblem: false,
      });
    });

    it('finds today in the current tab when an earlier year tab also exists', async () => {
      const sheet = new FakeSpreadsheet([
        {
          title: "Tracking '26",
          ...trackingTabGrid([['2026-12-31', 224]], {
            fields: FIELDS,
            checkIns: [['December 1st', [30, 14]]],
          }),
        },
        {
          title: "Tracking '27",
          ...trackingTabGrid([['2027-01-01', null]], {
            fields: FIELDS,
            checkIns: [['January 1st', [null, null]]],
          }),
        },
      ]);

      expect((await evaluateTrackingReminders(sheet, template, '2027-01-01')).kinds).toEqual([
        'bodyweight',
        'measurement',
      ]);
    });

    it('skips both reminders and logs the problem codes when a Tracking tab has a format problem', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sheet = new FakeSpreadsheet([
        { title: "Tracking '27", cells: [['Date', 'Weight']] },
      ]);

      expect(await evaluateTrackingReminders(sheet, template, '2027-07-01')).toEqual({
        kinds: [],
        trackingProblem: true,
      });
      expect(warn).toHaveBeenCalledWith(
        '[reminders] source spreadsheet problems',
        expect.objectContaining({
          event: 'tracking-problems',
          problems: expect.arrayContaining([
            expect.objectContaining({ code: 'missing-month-header' }),
          ]),
        })
      );
    });

    it('reports a problem when the spreadsheet has no Tracking tab', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sheet = new FakeSpreadsheet([{ title: 'Notes', cells: [['hello']] }]);

      const result = await evaluateTrackingReminders(sheet, template, '2027-07-01');

      expect(result.kinds).toEqual([]);
    });
  });

  describe('reminderNotification', () => {
    it('deep-links Bodyweight Reminder to today’s editor', () => {
      expect(reminderNotification('bodyweight', '2026-07-01')).toMatchObject({
        title: 'Bodyweight Reminder',
        url: '/body?date=2026-07-01',
        tag: 'bodyweight-reminder-2026-07-01',
      });
    });

    it('deep-links Measurement Reminder to today’s check-in editor', () => {
      expect(reminderNotification('measurement', '2026-07-01')).toMatchObject({
        title: 'Measurement Reminder',
        url: '/body?segment=check-ins&checkInDate=2026-07-01',
        tag: 'measurement-reminder-2026-07-01',
      });
    });

    it('deep-links the evening Steps Reminder to today’s editor', () => {
      expect(reminderNotification('steps', '2026-07-01')).toMatchObject({
        title: 'Steps Reminder',
        url: '/steps?date=2026-07-01',
        tag: 'steps-reminder-2026-07-01',
      });
    });

    it('deep-links the morning Steps Reminder to yesterday’s editor', () => {
      expect(reminderNotification('steps-yesterday', '2026-07-01')).toMatchObject({
        title: 'Steps Reminder',
        url: '/steps?date=2026-06-30',
        tag: 'steps-yesterday-reminder-2026-07-01',
      });
    });
  });
});
