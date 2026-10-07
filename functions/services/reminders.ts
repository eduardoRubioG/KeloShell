import type { PushNotificationPayload } from '../../src/contracts/push';
import type { CoachTemplate } from '../coach-templates/types';
import { logFormatProblems } from '../lib/format-problems';
import { addDays } from '../lib/local-date';
import type { SpreadsheetGateway } from '../lib/spreadsheet-gateway';

export type ReminderKind =
  | 'bodyweight'
  | 'measurement'
  | 'creatine'
  | 'steps'
  | 'steps-yesterday';

/**
 * Which Tracking-based reminders are due. `trackingProblem` is true when the
 * Subscriber's current Tracking tab could not be determined or interpreted; both reminders are then
 * skipped (`kinds` is empty) while App-Owned Data reminders are unaffected.
 */
export interface TrackingReminders {
  kinds: ReminderKind[];
  trackingProblem: boolean;
}

/**
 * Bodyweight Reminder: the current Tracking tab's row for today has no
 * positive weight. Measurement Reminder: a Measurement Check-In in the current
 * Tracking tab is dated today. When no tab holds today, neither is due and
 * that is not a problem.
 */
export async function evaluateTrackingReminders(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  today: string
): Promise<TrackingReminders> {
  const state = await template.tracking.readTodayReminderState(gateway, today);
  logFormatProblems('reminders', 'tracking-problems', state.problems);

  if (state.problems.length > 0) {
    return { kinds: [], trackingProblem: true };
  }

  const kinds: ReminderKind[] = [];
  if (state.todayEntry && !state.todayEntry.hasValue) kinds.push('bodyweight');
  if (state.measurementCheckInToday) kinds.push('measurement');
  return { kinds, trackingProblem: false };
}

interface ReminderCopy {
  title: string;
  body: string;
  url: string;
  actionTitle: string;
}

const REMINDER_COPY: Record<ReminderKind, (localDate: string) => ReminderCopy> = {
  bodyweight: (localDate) => ({
    title: 'Bodyweight Reminder',
    body: "Today's bodyweight is ready to log.",
    url: `/body?date=${localDate}`,
    actionTitle: 'Log bodyweight',
  }),
  creatine: () => ({
    title: 'Creatine Reminder',
    body: "You haven't logged today's creatine yet.",
    url: '/',
    actionTitle: 'Log creatine',
  }),
  steps: (localDate) => ({
    title: 'Steps Reminder',
    body: "Today's step count is ready to log.",
    url: `/steps?date=${localDate}`,
    actionTitle: 'Log steps',
  }),
  'steps-yesterday': (localDate) => ({
    title: 'Steps Reminder',
    body: "You haven't logged yesterday's steps yet.",
    url: `/steps?date=${addDays(localDate, -1)}`,
    actionTitle: 'Log steps',
  }),
  measurement: (localDate) => ({
    title: 'Measurement Reminder',
    body: "Today's Measurement Check-In is ready.",
    url: `/body?segment=check-ins&checkInDate=${localDate}`,
    actionTitle: 'Open Body Tracking',
  }),
};

export function reminderNotification(
  kind: ReminderKind,
  localDate: string
): PushNotificationPayload {
  const { title, body, url, actionTitle } = REMINDER_COPY[kind](localDate);
  return {
    title,
    body,
    url,
    tag: `${kind}-reminder-${localDate}`,
    vibrate: [100, 50, 100],
    requireInteraction: true,
    actions: [
      { action: 'open', title: actionTitle },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };
}
