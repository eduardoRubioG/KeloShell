export const DEFAULT_TIME_ZONE = 'America/New_York';

export interface LocalDateTime {
  date: string;
  hour: number;
  minute: number;
}

export interface LocalDateEnv {
  REMINDER_TIME_ZONE?: string;
}

export function localDateTime(now: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  if (
    !year ||
    !month ||
    !day ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new Error('The Local Calendar Date could not be determined.');
  }
  return { date: `${year}-${month}-${day}`, hour, minute };
}

export function resolveTimeZone(env: LocalDateEnv): string {
  return env.REMINDER_TIME_ZONE ?? DEFAULT_TIME_ZONE;
}

/** The Local Calendar Date (YYYY-MM-DD) in the configured time zone. */
export function todayLocalCalendarDate(env: LocalDateEnv, now: Date = new Date()): string {
  return localDateTime(now, resolveTimeZone(env)).date;
}

/** Shifts a YYYY-MM-DD calendar date by whole days. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
