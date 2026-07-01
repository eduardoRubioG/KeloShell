import { describe, expect, it } from 'vitest';

import {
  evaluateReminders,
  reminderNotification,
  type ReminderGateway,
} from './reminders';
import { SourceSpreadsheetSchemaError } from './config';

const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86_400_000;

function serial(isoDate: string): number {
  return (Date.parse(`${isoDate}T00:00:00Z`) - SHEETS_EPOCH) / DAY;
}

function gateway(bodyweightRows: unknown[][], measurementRows: unknown[][]): ReminderGateway {
  return {
    readRanges: async () => [bodyweightRows, measurementRows],
  };
}

describe('evaluateReminders', () => {
  it('returns both reminders when today has blank bodyweight and a Measurement Check-In', async () => {
    const result = await evaluateReminders(
      gateway(
        [['Date', 'Weight'], [serial('2026-07-01'), '']],
        [['Month'], ['June 15th'], ['July 1st']]
      ),
      '2026-07-01'
    );

    expect(result).toEqual(['bodyweight', 'measurement']);
  });

  it('does not return Bodyweight Reminder when today has a positive value', async () => {
    const result = await evaluateReminders(
      gateway(
        [['Date', 'Weight'], [serial('2026-07-01'), 225.4]],
        [['Month'], ['July 1st']]
      ),
      '2026-07-01'
    );

    expect(result).toEqual(['measurement']);
  });

  it('does not create reminders for dates absent from the Source Spreadsheet', async () => {
    const result = await evaluateReminders(
      gateway(
        [['Date', 'Weight'], [serial('2026-06-30'), '']],
        [['Month'], ['June 15th']]
      ),
      '2026-07-01'
    );

    expect(result).toEqual([]);
  });

  it('supports date serials in the Measurement Check-In column', async () => {
    const result = await evaluateReminders(
      gateway(
        [['Date', 'Weight'], [serial('2026-07-01'), 225]],
        [['Month'], [serial('2026-07-01')]]
      ),
      '2026-07-01'
    );

    expect(result).toEqual(['measurement']);
  });

  it('rejects an unrecognized tracking layout', async () => {
    await expect(
      evaluateReminders(gateway([['Day', 'Weight']], [['Month']]), '2026-07-01')
    ).rejects.toBeInstanceOf(SourceSpreadsheetSchemaError);
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

  it('uses a date-specific tag for Measurement Reminder', () => {
    expect(reminderNotification('measurement', '2026-07-01')).toMatchObject({
      title: 'Measurement Reminder',
      tag: 'measurement-reminder-2026-07-01',
    });
  });
});
