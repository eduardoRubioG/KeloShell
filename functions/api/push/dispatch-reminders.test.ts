import { describe, expect, it, vi } from 'vitest';

import type { PushNotificationPayload } from '../../../src/contracts/push';
import { FakeSpreadsheet, trackingTabGrid } from '../../testing/fake-spreadsheet';
import type { HabitsGateway } from '../../lib/streaks';
import type { UserId } from '../../lib/users';
import { addSubscription } from '../../lib/push-store';
import { localDateTime } from '../../lib/local-date';
import { handleDispatchRemindersRequest } from './dispatch-reminders';

interface UserResult {
  id: UserId;
  sent: number;
  reminders?: string[];
  skipped?: string;
  error?: string;
}

interface DispatchBody {
  date: string;
  sent: number;
  users: UserResult[];
}

async function body(response: Response): Promise<DispatchBody> {
  return (await response.json()) as DispatchBody;
}

function userOf(dispatch: DispatchBody, id: UserId = 'eduardo'): UserResult {
  const result = dispatch.users.find((user) => user.id === id);
  if (!result) throw new Error(`Expected a dispatch result for ${id}`);
  return result;
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

function makeGateway(
  weight: number | null | '',
  measurementLabels: string[],
  title = "Tracking '26",
  date = '2026-07-01'
): FakeSpreadsheet {
  return new FakeSpreadsheet([
    {
      title,
      ...trackingTabGrid([[date, weight === '' ? null : weight]], {
        fields: ['Waist', 'Neck'],
        checkIns: measurementLabels.map((label) => [label, [null, null]] as const),
      }),
    },
  ]);
}

function makeHabitsGateway(creatineDates: readonly string[] = []): HabitsGateway {
  return {
    readRanges: async () => [
      [['Date', 'Habit'], ...creatineDates.map((date) => [date, 'creatine'])],
    ],
    writeRange: async () => {},
    clearRange: async () => {},
  };
}

// The meta DB gateway serves both the Habits and Steps tabs; branch on the
// requested range so creatine and steps reads see the tab they expect.
function makeMetaDbGateway(
  creatineDates: readonly string[] = [],
  stepsDates: readonly string[] = []
): HabitsGateway {
  return {
    readRanges: async (ranges: readonly string[]) => {
      if (ranges.some((range) => range.includes('Steps'))) {
        return [
          [['Date', 'Steps'], ...stepsDates.map((date) => [date, 8000])],
        ];
      }
      return [
        [['Date', 'Habit'], ...creatineDates.map((date) => [date, 'creatine'])],
      ];
    },
    writeRange: async () => {},
    clearRange: async () => {},
  };
}

const noHabitsConfigured = () => makeHabitsGateway();

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

function configuredEnvWithHabits(kv: KVNamespace) {
  return {
    ...configuredEnv(kv),
    KELOSHELL_META_DB_SHEET: 'meta-db-sheet-id',
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

  it('skips scheduler retries before 7am local time', async () => {
    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnv(makeMockKV()),
      {
        now: () => new Date('2026-07-01T09:00:00Z'),
        createGateway: () => makeGateway('', ['July 1st']),
        createHabitsGateway: noHabitsConfigured,
        sendPush: vi.fn(),
      }
    );

    expect(response.status).toBe(200);
    const dispatch = await body(response);
    expect(dispatch.sent).toBe(0);
    expect(userOf(dispatch)).toMatchObject({ sent: 0, skipped: 'outside-window' });
  });

  it('marks an unconfigured user as not-configured', async () => {
    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnv(makeMockKV()),
      {
        now: () => new Date('2026-07-01T11:00:00Z'),
        createGateway: () => makeGateway(225, []),
        createHabitsGateway: noHabitsConfigured,
        sendPush: vi.fn(),
      }
    );

    const dispatch = await body(response);
    expect(userOf(dispatch, 'emily')).toMatchObject({ sent: 0, skipped: 'not-configured' });
  });

  it('still delivers a scheduler run delayed past the 7am hour', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    const notifications: PushNotificationPayload[] = [];

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnv(kv),
      {
        // GitHub Actions schedules are best-effort and can land hours late;
        // this exercises a run that arrives at 9:59am after missing every
        // candidate cron slot.
        now: () => new Date('2026-07-01T13:59:00Z'),
        createGateway: () => makeGateway('', ['July 1st']),
        createHabitsGateway: noHabitsConfigured,
        sendPush: async (_subscription, notification) => {
          notifications.push(notification);
          return { success: true, stale: false, status: 201 };
        },
      }
    );

    expect(response.status).toBe(200);
    const dispatch = await body(response);
    expect(dispatch.date).toBe('2026-07-01');
    expect(dispatch.sent).toBe(2);
    expect(userOf(dispatch)).toMatchObject({
      sent: 2,
      reminders: ['bodyweight', 'measurement'],
    });
  });

  it('delivers both due reminders to every subscription at 7am', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
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
        createHabitsGateway: noHabitsConfigured,
        sendPush: async (_subscription, notification) => {
          notifications.push(notification);
          return { success: true, stale: false, status: 201 };
        },
      }
    );

    expect(response.status).toBe(200);
    const dispatch = await body(response);
    expect(dispatch.date).toBe('2026-07-01');
    expect(dispatch.sent).toBe(2);
    expect(userOf(dispatch)).toMatchObject({
      sent: 2,
      reminders: ['bodyweight', 'measurement'],
    });
    expect(notifications.map((item) => item.title)).toEqual([
      'Bodyweight Reminder',
      'Measurement Reminder',
    ]);
    expect(notifications[0].url).toBe('/body?date=2026-07-01');
    expect(notifications[1].url).toBe(
      '/body?segment=check-ins&checkInDate=2026-07-01'
    );
  });

  it('does not redeliver a reminder already sent for the Local Calendar Date', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    const sendPush = vi.fn(async () => ({ success: true, stale: false, status: 201 }));
    const dependencies = {
      now: () => new Date('2026-07-01T11:00:00Z'),
      createGateway: () => makeGateway('', []),
      createHabitsGateway: noHabitsConfigured,
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
    expect(userOf(await body(second))).toMatchObject({
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
        createHabitsGateway: noHabitsConfigured,
        sendPush: vi.fn(),
      }
    );

    expect(response.status).toBe(200);
    expect(userOf(await body(response))).toMatchObject({ skipped: 'not-due' });
  });

  it('does not evaluate creatine before 9pm even if bodyweight is due', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    const notifications: PushNotificationPayload[] = [];
    const habitsGateway = vi.fn(() => makeHabitsGateway([]));

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnvWithHabits(kv),
      {
        now: () => new Date('2026-07-01T11:00:00Z'),
        createGateway: () => makeGateway(225, []),
        createHabitsGateway: habitsGateway,
        sendPush: async (_subscription, notification) => {
          notifications.push(notification);
          return { success: true, stale: false, status: 201 };
        },
      }
    );

    expect(habitsGateway).not.toHaveBeenCalled();
    expect(userOf(await body(response))).toMatchObject({ skipped: 'not-due' });
  });

  it('delivers a creatine reminder at 9pm when not logged today', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    const notifications: PushNotificationPayload[] = [];

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnvWithHabits(kv),
      {
        // 21:00 UTC is 5pm EDT; use 2026-07-02T01:00:00Z for 9pm EDT on July 1st.
        now: () => new Date('2026-07-02T01:00:00Z'),
        createGateway: () => makeGateway(225, []),
        createHabitsGateway: () => makeHabitsGateway([]),
        sendPush: async (_subscription, notification) => {
          notifications.push(notification);
          return { success: true, stale: false, status: 201 };
        },
      }
    );

    expect(response.status).toBe(200);
    const dispatch = await body(response);
    expect(dispatch.date).toBe('2026-07-01');
    expect(dispatch.sent).toBe(1);
    expect(userOf(dispatch)).toMatchObject({ sent: 1, reminders: ['creatine'] });
    expect(notifications.map((item) => item.title)).toEqual(['Creatine Reminder']);
  });

  it('does not remind about creatine already logged today', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnvWithHabits(kv),
      {
        now: () => new Date('2026-07-02T01:00:00Z'),
        createGateway: () => makeGateway(225, []),
        createHabitsGateway: () => makeHabitsGateway(['2026-07-01']),
        sendPush: vi.fn(),
      }
    );

    expect(response.status).toBe(200);
    expect(userOf(await body(response))).toMatchObject({
      sent: 0,
      skipped: 'not-due',
    });
  });

  it('does not evaluate steps before 10pm', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnvWithHabits(kv),
      {
        // 9pm EDT on July 1st: creatine is due, evening steps are not.
        now: () => new Date('2026-07-02T01:00:00Z'),
        createGateway: () => makeGateway(225, []),
        createHabitsGateway: () => makeMetaDbGateway(['2026-07-01'], []),
        sendPush: vi.fn(),
      }
    );

    expect(response.status).toBe(200);
    expect(userOf(await body(response))).toMatchObject({
      sent: 0,
      skipped: 'not-due',
    });
  });

  it('delivers an evening steps reminder at 10pm when today is unlogged', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    const notifications: PushNotificationPayload[] = [];

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnvWithHabits(kv),
      {
        // 10pm EDT on July 1st is 02:00 UTC on July 2nd.
        now: () => new Date('2026-07-02T02:00:00Z'),
        createGateway: () => makeGateway(225, []),
        createHabitsGateway: () => makeMetaDbGateway(['2026-07-01'], []),
        sendPush: async (_subscription, notification) => {
          notifications.push(notification);
          return { success: true, stale: false, status: 201 };
        },
      }
    );

    expect(response.status).toBe(200);
    const dispatch = await body(response);
    expect(dispatch.date).toBe('2026-07-01');
    expect(dispatch.sent).toBe(1);
    expect(userOf(dispatch)).toMatchObject({ sent: 1, reminders: ['steps'] });
    expect(notifications.map((item) => item.title)).toEqual(['Steps Reminder']);
    expect(notifications[0].url).toBe('/steps?date=2026-07-01');
  });

  it('does not remind about steps already logged today at 10pm', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnvWithHabits(kv),
      {
        now: () => new Date('2026-07-02T02:00:00Z'),
        createGateway: () => makeGateway(225, []),
        createHabitsGateway: () => makeMetaDbGateway(['2026-07-01'], ['2026-07-01']),
        sendPush: vi.fn(),
      }
    );

    expect(response.status).toBe(200);
    expect(userOf(await body(response))).toMatchObject({
      sent: 0,
      skipped: 'not-due',
    });
  });

  it('delivers a morning steps reminder at 7:30am when yesterday is unlogged', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    const notifications: PushNotificationPayload[] = [];

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnvWithHabits(kv),
      {
        // 7:30am EDT on July 2nd is 11:30 UTC; yesterday (July 1st) has no steps.
        now: () => new Date('2026-07-02T11:30:00Z'),
        createGateway: () => makeGateway(225, []),
        createHabitsGateway: () => makeMetaDbGateway([], []),
        sendPush: async (_subscription, notification) => {
          notifications.push(notification);
          return { success: true, stale: false, status: 201 };
        },
      }
    );

    expect(response.status).toBe(200);
    const dispatch = await body(response);
    expect(dispatch.date).toBe('2026-07-02');
    expect(dispatch.sent).toBe(1);
    expect(userOf(dispatch)).toMatchObject({ sent: 1, reminders: ['steps-yesterday'] });
    expect(notifications.map((item) => item.title)).toEqual(['Steps Reminder']);
    expect(notifications[0].url).toBe('/steps?date=2026-07-01');
  });

  it('does not send the morning steps reminder when yesterday is already logged', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnvWithHabits(kv),
      {
        now: () => new Date('2026-07-02T11:30:00Z'),
        createGateway: () => makeGateway(225, []),
        createHabitsGateway: () => makeMetaDbGateway([], ['2026-07-01']),
        sendPush: vi.fn(),
      }
    );

    expect(response.status).toBe(200);
    expect(userOf(await body(response))).toMatchObject({
      sent: 0,
      skipped: 'not-due',
    });
  });

  it('sends the expected reminders from a Tracking tab named for a later year on a forced run', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    const notifications: PushNotificationPayload[] = [];

    const response = await handleDispatchRemindersRequest(
      request('/api/push/dispatch-reminders?force=true'),
      configuredEnv(kv),
      {
        now: () => new Date('2027-07-01T15:00:00Z'),
        createGateway: () =>
          makeGateway('', ['July 1st'], "Tracking '27", '2027-07-01'),
        createHabitsGateway: noHabitsConfigured,
        sendPush: async (_subscription, notification) => {
          notifications.push(notification);
          return { success: true, stale: false, status: 201 };
        },
      }
    );

    expect(response.status).toBe(200);
    const dispatch = await body(response);
    expect(dispatch.date).toBe('2027-07-01');
    expect(userOf(dispatch)).toMatchObject({
      sent: 2,
      reminders: ['bodyweight', 'measurement'],
    });
    expect(notifications.map((item) => item.title)).toEqual([
      'Bodyweight Reminder',
      'Measurement Reminder',
    ]);
  });

  it('skips Bodyweight and Measurement Reminders on a Tracking problem but still sends creatine and reports source-schema', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/one',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    const notifications: PushNotificationPayload[] = [];

    const response = await handleDispatchRemindersRequest(
      request('/api/push/dispatch-reminders?force=true'),
      configuredEnvWithHabits(kv),
      {
        now: () => new Date('2026-07-02T01:00:00Z'),
        createGateway: () =>
          new FakeSpreadsheet([{ title: "Tracking '26", cells: [['Date', 'Weight']] }]),
        createHabitsGateway: () => makeHabitsGateway([]),
        sendPush: async (_subscription, notification) => {
          notifications.push(notification);
          return { success: true, stale: false, status: 201 };
        },
      }
    );

    expect(response.status).toBe(200);
    expect(userOf(await body(response))).toMatchObject({
      sent: 1,
      reminders: ['creatine'],
      error: 'source-schema',
    });
    expect(notifications.map((item) => item.title)).toEqual(['Creatine Reminder']);
  });

  it('reports source-schema with nothing sent when a Tracking problem leaves no other reminder due', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnv(makeMockKV()),
      {
        now: () => new Date('2026-07-01T11:00:00Z'),
        createGateway: () =>
          new FakeSpreadsheet([{ title: "Tracking '26", cells: [['Date', 'Weight']] }]),
        createHabitsGateway: noHabitsConfigured,
        sendPush: vi.fn(),
      }
    );

    expect(userOf(await body(response))).toMatchObject({
      sent: 0,
      reminders: [],
      error: 'source-schema',
    });
  });

  it('reports source-read when the spreadsheet cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = new FakeSpreadsheet([]);
    failing.listSheetTitles = async () => {
      throw new Error('boom');
    };

    const response = await handleDispatchRemindersRequest(
      request(),
      configuredEnv(makeMockKV()),
      {
        now: () => new Date('2026-07-01T11:00:00Z'),
        createGateway: () => failing,
        createHabitsGateway: noHabitsConfigured,
        sendPush: vi.fn(),
      }
    );

    expect(userOf(await body(response))).toMatchObject({ error: 'source-read' });
  });

  it('dispatches each user from their own sheets and subscriptions', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', {
      endpoint: 'https://push.example.com/eduardo',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    await addSubscription(kv, 'emily', {
      endpoint: 'https://push.example.com/emily',
      keys: { p256dh: 'dh', auth: 'auth' },
    });
    const sends: Array<{ endpoint: string; title: string }> = [];

    const response = await handleDispatchRemindersRequest(
      request(),
      {
        ...configuredEnvWithHabits(kv),
        EMILY_GOOGLE_SPREADSHEET_ID: 'emily-sheet-id',
        EMILY_META_DB_SHEET: 'emily-meta-id',
      },
      {
        // 9pm EDT on July 1st: only creatine is due.
        now: () => new Date('2026-07-02T01:00:00Z'),
        createGateway: () => makeGateway(225, []),
        // Eduardo has not logged creatine; Emily has.
        createHabitsGateway: (credentials) =>
          credentials.spreadsheetId === 'emily-meta-id'
            ? makeHabitsGateway(['2026-07-01'])
            : makeHabitsGateway([]),
        sendPush: async (subscription, notification) => {
          sends.push({ endpoint: subscription.endpoint, title: notification.title });
          return { success: true, stale: false, status: 201 };
        },
      }
    );

    expect(response.status).toBe(200);
    const dispatch = await body(response);
    expect(dispatch.sent).toBe(1);
    expect(userOf(dispatch, 'eduardo')).toMatchObject({ sent: 1, reminders: ['creatine'] });
    expect(userOf(dispatch, 'emily')).toMatchObject({ sent: 0, skipped: 'not-due' });
    // Only Eduardo's endpoint received a push.
    expect(sends).toEqual([
      { endpoint: 'https://push.example.com/eduardo', title: 'Creatine Reminder' },
    ]);
  });
});

describe('localDateTime', () => {
  it('uses daylight time for the Local Calendar Date', () => {
    expect(localDateTime(new Date('2026-07-01T11:00:00Z'), 'America/New_York')).toEqual({
      date: '2026-07-01',
      hour: 7,
      minute: 0,
    });
  });

  it('uses standard time for the Local Calendar Date', () => {
    expect(localDateTime(new Date('2026-01-01T12:00:00Z'), 'America/New_York')).toEqual({
      date: '2026-01-01',
      hour: 7,
      minute: 0,
    });
  });

  it('reports the local minute for a half-hour scheduler slot', () => {
    expect(localDateTime(new Date('2026-07-01T11:30:00Z'), 'America/New_York')).toEqual({
      date: '2026-07-01',
      hour: 7,
      minute: 30,
    });
  });
});
