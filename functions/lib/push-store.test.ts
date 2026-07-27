import { describe, expect, it } from 'vitest';

import type { PushSubscriptionPayload } from '../../src/contracts/push';
import {
  addSubscription,
  listDeliveredReminders,
  listSubscriptions,
  pruneSubscriptions,
  recordDeliveredReminders,
  removeSubscription,
} from './push-store';

const USER = 'eduardo';

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

function sub(endpoint: string): PushSubscriptionPayload {
  return { endpoint, keys: { p256dh: 'dh-' + endpoint, auth: 'auth-' + endpoint } };
}

describe('listSubscriptions', () => {
  it('returns empty array when KV key is absent', async () => {
    const kv = makeMockKV();
    expect(await listSubscriptions(kv, USER)).toEqual([]);
  });

  it('returns stored subscriptions', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, USER, sub('https://a.example/push/1'));
    const list = await listSubscriptions(kv, USER);
    expect(list).toHaveLength(1);
    expect(list[0].endpoint).toBe('https://a.example/push/1');
  });
});

describe('addSubscription', () => {
  it('adds a new subscription', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, USER, sub('https://a.example/push/1'));
    expect(await listSubscriptions(kv, USER)).toHaveLength(1);
  });

  it('deduplicates by endpoint, keeping the latest', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, USER, sub('https://a.example/push/1'));
    const updated = { endpoint: 'https://a.example/push/1', keys: { p256dh: 'new-dh', auth: 'new-auth' } };
    await addSubscription(kv, USER, updated);
    const list = await listSubscriptions(kv, USER);
    expect(list).toHaveLength(1);
    expect(list[0].keys.p256dh).toBe('new-dh');
  });

  it('keeps distinct endpoints separate', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, USER, sub('https://a.example/push/1'));
    await addSubscription(kv, USER, sub('https://b.example/push/2'));
    expect(await listSubscriptions(kv, USER)).toHaveLength(2);
  });
});

describe('removeSubscription', () => {
  it('removes the matching endpoint', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, USER, sub('https://a.example/push/1'));
    await addSubscription(kv, USER, sub('https://b.example/push/2'));
    await removeSubscription(kv, USER, 'https://a.example/push/1');
    const list = await listSubscriptions(kv, USER);
    expect(list).toHaveLength(1);
    expect(list[0].endpoint).toBe('https://b.example/push/2');
  });

  it('is a no-op for an unknown endpoint', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, USER, sub('https://a.example/push/1'));
    await removeSubscription(kv, USER, 'https://z.example/push/99');
    expect(await listSubscriptions(kv, USER)).toHaveLength(1);
  });
});

describe('pruneSubscriptions', () => {
  it('removes all stale endpoints at once', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, USER, sub('https://a.example/push/1'));
    await addSubscription(kv, USER, sub('https://b.example/push/2'));
    await addSubscription(kv, USER, sub('https://c.example/push/3'));
    await pruneSubscriptions(kv, USER, [
      'https://a.example/push/1',
      'https://c.example/push/3',
    ]);
    const list = await listSubscriptions(kv, USER);
    expect(list).toHaveLength(1);
    expect(list[0].endpoint).toBe('https://b.example/push/2');
  });

  it('is a no-op when the stale list is empty', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, USER, sub('https://a.example/push/1'));
    await pruneSubscriptions(kv, USER, []);
    expect(await listSubscriptions(kv, USER)).toHaveLength(1);
  });
});

describe('per-user namespacing', () => {
  it('keeps each user’s subscriptions isolated', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, 'eduardo', sub('https://a.example/push/1'));
    await addSubscription(kv, 'emily', sub('https://b.example/push/2'));

    expect(await listSubscriptions(kv, 'eduardo')).toHaveLength(1);
    expect((await listSubscriptions(kv, 'eduardo'))[0].endpoint).toBe('https://a.example/push/1');
    expect(await listSubscriptions(kv, 'emily')).toHaveLength(1);
    expect((await listSubscriptions(kv, 'emily'))[0].endpoint).toBe('https://b.example/push/2');
  });

  it('falls back to the legacy global key for Eduardo until a namespaced write', async () => {
    const kv = makeMockKV();
    // Simulate a pre-multi-user subscription stored under the old global key.
    await kv.put('push:subscriptions', JSON.stringify([sub('https://legacy.example/1')]));

    // Eduardo reads through to the legacy key; Emily never does.
    expect(await listSubscriptions(kv, 'eduardo')).toHaveLength(1);
    expect(await listSubscriptions(kv, 'emily')).toHaveLength(0);

    // A new subscription migrates him onto the namespaced key.
    await addSubscription(kv, 'eduardo', sub('https://new.example/2'));
    const migrated = await listSubscriptions(kv, 'eduardo');
    expect(migrated.map((s) => s.endpoint)).toEqual([
      'https://legacy.example/1',
      'https://new.example/2',
    ]);
  });

  it('keeps each user’s delivery records isolated', async () => {
    const kv = makeMockKV();
    await recordDeliveredReminders(kv, 'eduardo', '2026-07-01', ['bodyweight']);

    expect(await listDeliveredReminders(kv, 'emily', '2026-07-01')).toEqual([]);
    expect(await listDeliveredReminders(kv, 'eduardo', '2026-07-01')).toEqual(['bodyweight']);
  });
});

describe('reminder delivery records', () => {
  it('records delivered kinds without duplicates', async () => {
    const kv = makeMockKV();
    await recordDeliveredReminders(kv, USER, '2026-07-01', ['bodyweight']);
    await recordDeliveredReminders(kv, USER, '2026-07-01', [
      'bodyweight',
      'measurement',
    ]);

    expect(await listDeliveredReminders(kv, USER, '2026-07-01')).toEqual([
      'bodyweight',
      'measurement',
    ]);
  });

  it('retains creatine and steps delivery records across reads', async () => {
    const kv = makeMockKV();
    await recordDeliveredReminders(kv, USER, '2026-07-01', [
      'creatine',
      'steps',
      'steps-yesterday',
    ]);

    expect(await listDeliveredReminders(kv, USER, '2026-07-01')).toEqual([
      'creatine',
      'steps',
      'steps-yesterday',
    ]);
  });

  it('isolates delivery records by Local Calendar Date', async () => {
    const kv = makeMockKV();
    await recordDeliveredReminders(kv, USER, '2026-07-01', ['bodyweight']);

    expect(await listDeliveredReminders(kv, USER, '2026-07-02')).toEqual([]);
  });
});
