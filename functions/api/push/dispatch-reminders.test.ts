import { describe, expect, it, vi } from 'vitest';

import type { PushNotificationPayload } from '../../../src/contracts/push';
import type { ReminderGateway } from '../../lib/reminders';
import { addSubscription } from '../../lib/push-store';
import {
  handleDispatchRemindersRequest,
  localDateTime,
} from './dispatch-reminders';

const SHEETS_EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86_400_000;

function serial(isoDate: string): number {
  return (Date.parse(`${isoDate}T00:00:00Z`) - SHEETS_EPOCH) / DAY;
}

function makeMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    put: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
  } as unknown as KVNamespace;
}

function makeGateway(weight: unknown, measurementDates: unknown[]): ReminderGateway {
  return {
    readRanges: async () => [
      [['Date', 'Weight'], [serial('2026-07-01'), weight]],
      [['Month'], ...measurementDates.map((date) => [date])],
    ],
  };
}

function configuredEnv(kv: KVNamespace) {
  return {
    PUSH_KV: kv,
    VAPID_PUBLIC_KEY: 'public',
    VAPID_PRIVATE_KEY: 'private',
    VAPID_SUBJECT: 'mailto:test@example.com',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
    GOOGLE_PRIVATE_KEY: 'google-private',
    GOOGLE_SPREADSHEET_ID: 'sheet-id',
    REMINDER_DISPATCH_TOKEN: 'dispatch-token',
    REMINDER_TIME_ZONE: 'America/New_York',
  };
}

function request(path = '/api/push/dispatch-reminders'): Request {
  return new Request(`https://app.example.com${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer dispatch-token' },
  });
}

describe('POST /api/push/dispatch-reminders', () => {
  it('requires the scheduler bearer token', async () => {
    const response = await handleDispatchRemindersRequest(
      new Request('https://app.example.com/api/push/dispatch-reminders', {
        method: 'POST',
      }),
      configuredEnv(makeMockKV())
    );

    expect(response.status).toBe(401);
  });

  it('skips scheduler retries outside 7am local time', async () => {
    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnv(makeMockKV()),
      {
        now: () => new Date('2026-07-01T12:00:00Z'),
        createGateway: () => makeGateway('', ['July 1st']),
        sendPush: vi.fn(),
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sent: 0,
      skipped: 'outside-window',
    });
  });

  it('delivers both due reminders to every subscription at 7am', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    const notifications: PushNotificationPayload[] = [];

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnv(kv),
      {
        now: () => new Date('2026-07-01T11:00:00Z'),
        createGateway: () => makeGateway('', ['July 1st']),
        sendPush: async (_subscription, notification) => {
          notifications.push(notification);
          return { success: true, stale: false, status: 201 };
        },
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      date: '2026-07-01',
      sent: 2,
      reminders: ['bodyweight', 'measurement'],
    });
    expect(notifications.map((item) => item.title)).toEqual([
      'Bodyweight Reminder',
      'Measurement Reminder',
    ]);
  });

  it('does not redeliver a reminder already sent for the Local Calendar Date', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    const sendPush = vi.fn(async () => ({ success: true, stale: false, status: 201 }));
    const dependencies = {
      now: () => new Date('2026-07-01T11:00:00Z'),
      createGateway: () => makeGateway('', []),
      sendPush,
    };

    const first = await handleDispatchRemindersRequest(
      request(),
      configuredEnv(kv),
      dependencies
    );
    const second = await handleDispatchRemindersRequest(
      request(),
      configuredEnv(kv),
      dependencies
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      sent: 0,
      skipped: 'already-delivered',
    });
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it('allows an authenticated forced run for deployment verification', async () => {
    const response = await handleDispatchRemindersRequest(
      request('/api/push/dispatch-reminders?force=true'),
      configuredEnv(makeMockKV()),
      {
        now: () => new Date('2026-07-01T15:00:00Z'),
        createGateway: () => makeGateway(225, []),
        sendPush: vi.fn(),
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ skipped: 'not-due' });
  });
});

describe('localDateTime', () => {
  it('uses daylight time for the Local Calendar Date', () => {
    expect(localDateTime(new Date('2026-07-01T11:00:00Z'), 'America/New_York')).toEqual({
      date: '2026-07-01',
      hour: 7,
    });
  });

  it('uses standard time for the Local Calendar Date', () => {
    expect(localDateTime(new Date('2026-01-01T12:00:00Z'), 'America/New_York')).toEqual({
      date: '2026-01-01',
      hour: 7,
    });
  });
});
