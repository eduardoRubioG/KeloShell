import type { PushNotificationPayload } from '../../src/contracts/push';
import type { CoachTemplate } from '../coach-templates/types';
import type { FormatProblem } from '../lib/format-problems';
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
 * Subscriber's Tracking tabs could not be interpreted; both reminders are then
 * skipped (`kinds` is empty) while App-Owned Data reminders are unaffected.
 */
export interface TrackingReminders {
  kinds: ReminderKind[];
  trackingProblem: boolean;
}

// Problems are logged here, not in the adapter, so they surface in the
// Cloudflare logs whichever Coach Template reported them.
function logProblems(problems: readonly FormatProblem[]): void {
  if (problems.length > 0) {
    console.warn('[reminders] source spreadsheet problems', {
      event: 'tracking-problems',
      problems,
    });
  }
}

/**
 * Bodyweight Reminder: today has a Daily Bodyweight row with no positive
 * weight. Measurement Reminder: a Measurement Check-In is dated today.
 */
export async function evaluateTrackingReminders(
  gateway: SpreadsheetGateway,
  template: CoachTemplate,
  today: string
): Promise<TrackingReminders> {
  const tracking = await template.tracking.readTracking(gateway, today);
  const measurements = await template.tracking.readMeasurements(gateway);
  logProblems(tracking.problems);
  logProblems(measurements.problems);

  if (tracking.problems.length > 0 || !measurements.ok || measurements.problems.length > 0) {
    return { kinds: [], trackingProblem: true };
  }

  const kinds: ReminderKind[] = [];
  if (tracking.todayEntry && !tracking.todayEntry.hasValue) kinds.push('bodyweight');
  if (measurements.response.checkIns.some((checkIn) => checkIn.date === today)) {
    kinds.push('measurement');
  }
  return { kinds, trackingProblem: false };
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

  if (kind === 'creatine') {
    return {
      title: 'Creatine Reminder',
      body: "You haven't logged today's creatine yet.",
      url: '/',
      tag: `creatine-reminder-${localDate}`,
      vibrate: [100, 50, 100],
      requireInteraction: true,
      actions: [
        { action: 'open', title: 'Log creatine' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };
  }

  if (kind === 'steps') {
    return {
      title: 'Steps Reminder',
      body: "Today's step count is ready to log.",
      url: `/steps?date=${localDate}`,
      tag: `steps-reminder-${localDate}`,
      vibrate: [100, 50, 100],
      requireInteraction: true,
      actions: [
        { action: 'open', title: 'Log steps' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };
  }

  if (kind === 'steps-yesterday') {
    const yesterday = addDays(localDate, -1);
    return {
      title: 'Steps Reminder',
      body: "You haven't logged yesterday's steps yet.",
      url: `/steps?date=${yesterday}`,
      tag: `steps-yesterday-reminder-${localDate}`,
      vibrate: [100, 50, 100],
      requireInteraction: true,
      actions: [
        { action: 'open', title: 'Log steps' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };
  }

  return {
    title: 'Measurement Reminder',
    body: "Today's Measurement Check-In is ready.",
    url: `/body?segment=check-ins&checkInDate=${localDate}`,
    tag: `measurement-reminder-${localDate}`,
    vibrate: [100, 50, 100],
    requireInteraction: true,
    actions: [
      { action: 'open', title: 'Open Body Tracking' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };
}
