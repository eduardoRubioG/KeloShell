import type { ApiErrorResponse } from '../../../src/contracts/training';
import type {
  PushNotificationPayload,
  PushSubscriptionPayload,
} from '../../../src/contracts/push';
import { SourceSpreadsheetSchemaError } from '../../lib/config';
import { GoogleSheetsClient } from '../../lib/google-sheets';
import {
  evaluateReminders,
  reminderNotification,
  type ReminderGateway,
  type ReminderKind,
} from '../../lib/reminders';
import { readCreatineDates, type HabitsGateway } from '../../lib/streaks';
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

const DEFAULT_TIME_ZONE = 'America/New_York';
const BODY_TRACKING_REMINDER_HOUR = 7;
const CREATINE_REMINDER_HOUR = 21;

interface Env {
  PUSH_KV?: KVNamespace;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  GOOGLE_SPREADSHEET_ID?: string;
  KELOSHELL_META_DB_SHEET?: string;
  REMINDER_DISPATCH_TOKEN?: string;
  REMINDER_TIME_ZONE?: string;
}

interface RequiredGoogleEnv {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
  GOOGLE_SPREADSHEET_ID: string;
}

interface RequiredHabitsEnv {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
  KELOSHELL_META_DB_SHEET: string;
}

interface Dependencies {
  now: () => Date;
  createGateway: (env: RequiredGoogleEnv) => ReminderGateway;
  createHabitsGateway: (env: RequiredHabitsEnv) => HabitsGateway;
  sendPush: (
    subscription: PushSubscriptionPayload,
    notification: PushNotificationPayload,
    vapid: VapidConfig
  ) => Promise<SendResult>;
}

const defaultDependencies: Dependencies = {
  now: () => new Date(),
  createGateway: (env) =>
    new GoogleSheetsClient({
      clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      privateKey: env.GOOGLE_PRIVATE_KEY,
      spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
    }),
  createHabitsGateway: (env) =>
    new GoogleSheetsClient({
      clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      privateKey: env.GOOGLE_PRIVATE_KEY,
      spreadsheetId: env.KELOSHELL_META_DB_SHEET,
    }),
  sendPush: sendWebPush,
};

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
  const google = configuredGoogleEnv(env);
  if (!vapid || !google || !env.PUSH_KV) {
    return json({ error: 'Scheduled reminders are not configured.' }, 503);
  }

  let local: { date: string; hour: number };
  try {
    local = localDateTime(
      dependencies.now(),
      env.REMINDER_TIME_ZONE ?? DEFAULT_TIME_ZONE
    );
  } catch {
    return json({ error: 'The reminder timezone is invalid.' }, 500);
  }

  const force = new URL(request.url).searchParams.get('force') === 'true';
  const activeReminders: ReminderKind[] = [];
  let evaluatedAny = false;

  if (force || local.hour >= BODY_TRACKING_REMINDER_HOUR) {
    evaluatedAny = true;
    try {
      activeReminders.push(
        ...(await evaluateReminders(dependencies.createGateway(google), local.date))
      );
    } catch (error) {
      if (error instanceof SourceSpreadsheetSchemaError) {
        return json(
          { error: 'The Source Spreadsheet structure could not be interpreted.' },
          422
        );
      }
      console.error('[push/dispatch-reminders] spreadsheet read failed:', error);
      return json({ error: 'The Source Spreadsheet could not be read.' }, 502);
    }
  }

  const habits = configuredHabitsEnv(env);
  if (habits && (force || local.hour >= CREATINE_REMINDER_HOUR)) {
    evaluatedAny = true;
    try {
      const creatineDates = await readCreatineDates(
        dependencies.createHabitsGateway(habits)
      );
      if (!creatineDates.has(local.date)) activeReminders.push('creatine');
    } catch (error) {
      console.error('[push/dispatch-reminders] habits read failed:', error);
    }
  }

  if (!evaluatedAny) {
    return json({ date: local.date, sent: 0, reminders: [], skipped: 'outside-window' }, 200);
  }

  const delivered = await listDeliveredReminders(env.PUSH_KV, local.date);
  const pending = activeReminders.filter((kind) => !delivered.includes(kind));
  if (pending.length === 0) {
    return json(
      {
        date: local.date,
        sent: 0,
        reminders: [],
        skipped: activeReminders.length > 0 ? 'already-delivered' : 'not-due',
      },
      200
    );
  }

  const subscriptions = await listSubscriptions(env.PUSH_KV);
  if (subscriptions.length === 0) {
    return json({ error: 'No push subscriptions found.' }, 404);
  }

  const staleEndpoints = new Set<string>();
  const successfulKinds: ReminderKind[] = [];
  const statuses: number[] = [];
  let sent = 0;

  for (const kind of pending) {
    const notification = reminderNotification(kind, local.date);
    let kindSent = 0;
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          const result = await dependencies.sendPush(subscription, notification, vapid);
          statuses.push(result.status);
          if (result.stale) staleEndpoints.add(subscription.endpoint);
          if (result.success) {
            kindSent += 1;
            sent += 1;
          }
        } catch (error) {
          console.error('[push/dispatch-reminders] sendWebPush threw:', error);
          statuses.push(0);
        }
      })
    );
    if (kindSent > 0) successfulKinds.push(kind);
  }

  if (staleEndpoints.size > 0) {
    await pruneSubscriptions(env.PUSH_KV, [...staleEndpoints]);
  }
  if (successfulKinds.length > 0) {
    await recordDeliveredReminders(env.PUSH_KV, local.date, successfulKinds);
  }

  if (sent === 0 && staleEndpoints.size === subscriptions.length) {
    return json(
      { error: 'All subscriptions were expired and have been removed.', statuses },
      410
    );
  }
  if (sent === 0) {
    return json({ error: 'The reminders could not be delivered.', statuses }, 502);
  }

  return json({ date: local.date, sent, reminders: successfulKinds }, 200);
}

export function localDateTime(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = Number(value('hour'));
  if (!year || !month || !day || !Number.isInteger(hour)) {
    throw new Error('The Local Calendar Date could not be determined.');
  }
  return { date: `${year}-${month}-${day}`, hour };
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

function configuredGoogleEnv(env: Env): RequiredGoogleEnv | null {
  if (
    !env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !env.GOOGLE_PRIVATE_KEY ||
    !env.GOOGLE_SPREADSHEET_ID
  ) {
    return null;
  }
  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: env.GOOGLE_PRIVATE_KEY,
    GOOGLE_SPREADSHEET_ID: env.GOOGLE_SPREADSHEET_ID,
  };
}

function configuredHabitsEnv(env: Env): RequiredHabitsEnv | null {
  if (
    !env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !env.GOOGLE_PRIVATE_KEY ||
    !env.KELOSHELL_META_DB_SHEET
  ) {
    return null;
  }
  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: env.GOOGLE_PRIVATE_KEY,
    KELOSHELL_META_DB_SHEET: env.KELOSHELL_META_DB_SHEET,
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
