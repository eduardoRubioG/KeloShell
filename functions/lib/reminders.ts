import type { PushNotificationPayload } from '../../src/contracts/push';
import { BODYWEIGHT_SHEET_NAME, SourceSpreadsheetSchemaError } from './config';

const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MONTHS = new Map(
  [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ].map((month, index) => [month, index + 1])
);

export type ReminderKind = 'bodyweight' | 'measurement';

export interface ReminderGateway {
  readRanges(
    ranges: readonly string[],
    valueRenderOption: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'
  ): Promise<unknown[][][]>;
}

export async function evaluateReminders(
  gateway: ReminderGateway,
  localDate: string
): Promise<ReminderKind[]> {
  const escapedName = BODYWEIGHT_SHEET_NAME.replace(/'/g, "''");
  const [bodyweightRows, measurementRows] = await gateway.readRanges(
    [`'${escapedName}'!A:B`, `'${escapedName}'!G:G`],
    'UNFORMATTED_VALUE'
  );

  if (!bodyweightRows || !measurementRows) {
    throw new SourceSpreadsheetSchemaError('The body tracking ranges could not be read.');
  }

  const bodyweightHeader = bodyweightRows.findIndex(
    (row) => cellText(row?.[0]) === 'Date' && cellText(row?.[1]) === 'Weight'
  );
  if (bodyweightHeader === -1) {
    throw new SourceSpreadsheetSchemaError(
      'The Bodyweight section does not contain a Date/Weight header row.'
    );
  }

  const measurementHeader = measurementRows.findIndex(
    (row) => cellText(row?.[0]) === 'Month'
  );
  if (measurementHeader === -1) {
    throw new SourceSpreadsheetSchemaError(
      'The Measurement Check-In section does not contain a Month header row.'
    );
  }

  const bodyweightRow = bodyweightRows
    .slice(bodyweightHeader + 1)
    .find((row) => spreadsheetDate(row?.[0]) === localDate);
  const hasBodyweightReminder = Boolean(
    bodyweightRow && !isPositiveDecimal(bodyweightRow[1])
  );
  const localMonthDay = localDate.slice(5);
  const hasMeasurementReminder = measurementRows
    .slice(measurementHeader + 1)
    .some((row) => measurementMonthDay(row?.[0]) === localMonthDay);

  const reminders: ReminderKind[] = [];
  if (hasBodyweightReminder) reminders.push('bodyweight');
  if (hasMeasurementReminder) reminders.push('measurement');
  return reminders;
}

export function reminderNotification(
  kind: ReminderKind,
  localDate: string
): PushNotificationPayload {
  if (kind === 'bodyweight') {
    return {
      title: 'Bodyweight Reminder',
      body: "Today's bodyweight is ready to log.",
      url: `/body?date=${localDate}`,
      tag: `bodyweight-reminder-${localDate}`,
      vibrate: [100, 50, 100],
      requireInteraction: true,
      actions: [
        { action: 'open', title: 'Log bodyweight' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };
  }

  return {
    title: 'Measurement Reminder',
    body: "Today's Measurement Check-In is ready.",
    url: '/body',
    tag: `measurement-reminder-${localDate}`,
    vibrate: [100, 50, 100],
    requireInteraction: true,
    actions: [
      { action: 'open', title: 'Open Body Tracking' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };
}

function spreadsheetDate(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return new Date(SHEETS_EPOCH_UTC + Math.floor(value) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function measurementMonthDay(value: unknown): string | null {
  if (typeof value === 'number') return spreadsheetDate(value)?.slice(5) ?? null;
  const match = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+\d{4})?$/i.exec(
    cellText(value)
  );
  if (!match) return null;
  const month = MONTHS.get(match[1].toLowerCase());
  const day = Number(match[2]);
  if (!month || !Number.isInteger(day)) return null;
  const date = new Date(Date.UTC(2000, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isPositiveDecimal(value: unknown): boolean {
  const parsed = typeof value === 'number' ? value : Number(cellText(value));
  return Number.isFinite(parsed) && parsed > 0;
}

function cellText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}
