import type { ApiErrorResponse } from '../../../src/contracts/training';
import type {
  PushNotificationPayload,
  PushSubscriptionPayload,
} from '../../../src/contracts/push';
import { SourceSpreadsheetSchemaError } from '../../lib/config';
import { GoogleSheetsClient, type GoogleSheetsCredentials } from '../../lib/google-sheets';
import {
  evaluateReminders,
  reminderNotification,
  type ReminderGateway,
  type ReminderKind,
} from '../../lib/reminders';
import { readCreatineDates, type HabitsGateway } from '../../lib/streaks';
import { readLoggedStepsDates } from '../../lib/steps-tracking';
import {
  listDeliveredReminders,
  listSubscriptions,
  pruneSubscriptions,
  recordDeliveredReminders,
} from '../../lib/push-store';
import {
  sendWebPush,
  type SendResult,
  type VapidConfig,
} from '../../lib/web-push';
import {
  ALL_USER_IDS,
  getMetaCredentials,
  getSourceCredentials,
  type UserId,
  type UserResolutionEnv,
} from '../../lib/users';

const DEFAULT_TIME_ZONE = 'America/New_York';
const BODY_TRACKING_START_MINUTES = 7 * 60; // 07:00 local
const STEPS_MORNING_START_MINUTES = 7 * 60 + 30; // 07:30 local
const MORNING_END_MINUTES = 12 * 60; // noon; keeps the morning steps prompt out of the evening
const CREATINE_START_MINUTES = 21 * 60; // 21:00 local
const STEPS_EVENING_START_MINUTES = 22 * 60; // 22:00 local

// The cron worker calls this endpoint with an Access service token, so there is
// no per-request user identity. Instead the dispatcher fans out over every
// configured user, reading each one's own spreadsheets and push subscriptions.
interface Env extends UserResolutionEnv {
  PUSH_KV?: KVNamespace;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  REMINDER_DISPATCH_TOKEN?: string;
  REMINDER_TIME_ZONE?: string;
}

interface Dependencies {
  now: () => Date;
  createGateway: (credentials: GoogleSheetsCredentials) => ReminderGateway;
  createHabitsGateway: (credentials: GoogleSheetsCredentials) => HabitsGateway;
  sendPush: (
    subscription: PushSubscriptionPayload,
    notification: PushNotificationPayload,
    vapid: VapidConfig
  ) => Promise<SendResult>;
}

const defaultDependencies: Dependencies = {
  now: () => new Date(),
  createGateway: (credentials) => new GoogleSheetsClient(credentials),
  createHabitsGateway: (credentials) => new GoogleSheetsClient(credentials),
  sendPush: sendWebPush,
};

interface LocalDateTime {
  date: string;
  hour: number;
  minute: number;
}

interface UserDispatchResult {
  id: UserId;
  sent: number;
  reminders: ReminderKind[];
  skipped?: string;
  error?: string;
}

export const onRequest: PagesFunction<Env> = (context) =>
  handleDispatchRemindersRequest(context.request, context.env);

export async function handleDispatchRemindersRequest(
  request: Request,
  env: Env,
  dependencies: Dependencies = defaultDependencies
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
  }

  if (!isAuthorized(request, env.REMINDER_DISPATCH_TOKEN)) {
    return json({ error: 'A valid reminder dispatch token is required.' }, 401);
  }

  const vapid = configuredVapid(env);
  if (!vapid || !env.PUSH_KV) {
    return json({ error: 'Scheduled reminders are not configured.' }, 503);
  }

  let local: LocalDateTime;
  try {
    local = localDateTime(
      dependencies.now(),
      env.REMINDER_TIME_ZONE ?? DEFAULT_TIME_ZONE
    );
  } catch {
    return json({ error: 'The reminder timezone is invalid.' }, 500);
  }

  const force = new URL(request.url).searchParams.get('force') === 'true';

  // No per-request identity here (cron uses an Access service token), so dispatch
  // for every configured user. One user's missing config or empty subscription
  // list is recorded on that user's result rather than failing the whole run.
  const users: UserDispatchResult[] = [];
  let sent = 0;
  for (const userId of ALL_USER_IDS) {
    const result = await dispatchForUser(
      userId,
      env,
      env.PUSH_KV,
      dependencies,
      vapid,
      local,
      force
    );
    users.push(result);
    sent += result.sent;
  }

  return json({ date: local.date, sent, users }, 200);
}

async function dispatchForUser(
  userId: UserId,
  env: Env,
  kv: KVNamespace,
  deps: Dependencies,
  vapid: VapidConfig,
  local: LocalDateTime,
  force: boolean
): Promise<UserDispatchResult> {
  const source = getSourceCredentials(userId, env);
  const meta = getMetaCredentials(userId, env);
  if (!source && !meta) {
    return { id: userId, sent: 0, reminders: [], skipped: 'not-configured' };
  }

  const minuteOfDay = local.hour * 60 + local.minute;
  const activeReminders: ReminderKind[] = [];
  let evaluatedAny = false;

  if (source && (force || minuteOfDay >= BODY_TRACKING_START_MINUTES)) {
    evaluatedAny = true;
    try {
      activeReminders.push(
        ...(await evaluateReminders(deps.createGateway(source), local.date))
      );
    } catch (error) {
      if (error instanceof SourceSpreadsheetSchemaError) {
        return { id: userId, sent: 0, reminders: [], error: 'source-schema' };
      }
      console.error(`[push/dispatch-reminders] ${userId} spreadsheet read failed:`, error);
      return { id: userId, sent: 0, reminders: [], error: 'source-read' };
    }
  }

  const creatineDue = force || minuteOfDay >= CREATINE_START_MINUTES;
  const stepsEveningDue = force || minuteOfDay >= STEPS_EVENING_START_MINUTES;
  const stepsMorningDue =
    force ||
    (minuteOfDay >= STEPS_MORNING_START_MINUTES && minuteOfDay < MORNING_END_MINUTES);

  if (meta && (creatineDue || stepsEveningDue || stepsMorningDue)) {
    evaluatedAny = true;
    const habitsGateway = deps.createHabitsGateway(meta);

    if (creatineDue) {
      try {
        const creatineDates = await readCreatineDates(habitsGateway);
        if (!creatineDates.has(local.date)) activeReminders.push('creatine');
      } catch (error) {
        console.error(`[push/dispatch-reminders] ${userId} habits read failed:`, error);
      }
    }

    if (stepsEveningDue || stepsMorningDue) {
      try {
        const stepsDates = await readLoggedStepsDates(habitsGateway);
        if (stepsEveningDue && !stepsDates.has(local.date)) {
          activeReminders.push('steps');
        }
        if (stepsMorningDue && !stepsDates.has(addDays(local.date, -1))) {
          activeReminders.push('steps-yesterday');
        }
      } catch (error) {
        console.error(`[push/dispatch-reminders] ${userId} steps read failed:`, error);
      }
    }
  }

  if (!evaluatedAny) {
    return { id: userId, sent: 0, reminders: [], skipped: 'outside-window' };
  }

  const delivered = await listDeliveredReminders(kv, userId, local.date);
  const pending = activeReminders.filter((kind) => !delivered.includes(kind));
  if (pending.length === 0) {
    return {
      id: userId,
      sent: 0,
      reminders: [],
      skipped: activeReminders.length > 0 ? 'already-delivered' : 'not-due',
    };
  }

  const subscriptions = await listSubscriptions(kv, userId);
  if (subscriptions.length === 0) {
    return { id: userId, sent: 0, reminders: [], skipped: 'no-subscriptions' };
  }

  const staleEndpoints = new Set<string>();
  const successfulKinds: ReminderKind[] = [];
  let sent = 0;

  for (const kind of pending) {
    const notification = reminderNotification(kind, local.date);
    let kindSent = 0;
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          const result = await deps.sendPush(subscription, notification, vapid);
          if (result.stale) staleEndpoints.add(subscription.endpoint);
          if (result.success) {
            kindSent += 1;
            sent += 1;
          }
        } catch (error) {
          console.error(`[push/dispatch-reminders] ${userId} sendWebPush threw:`, error);
        }
      })
    );
    if (kindSent > 0) successfulKinds.push(kind);
  }

  if (staleEndpoints.size > 0) {
    await pruneSubscriptions(kv, userId, [...staleEndpoints]);
  }
  if (successfulKinds.length > 0) {
    await recordDeliveredReminders(kv, userId, local.date, successfulKinds);
  }

  return { id: userId, sent, reminders: successfulKinds };
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

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isAuthorized(request: Request, expectedToken: string | undefined): boolean {
  if (!expectedToken) return false;
  return request.headers.get('authorization') === `Bearer ${expectedToken}`;
}

function configuredVapid(env: Env): VapidConfig | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}

function json(
  body: Record<string, unknown> | ApiErrorResponse,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}
