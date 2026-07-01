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
    expect(await listSubscriptions(kv)).toEqual([]);
  });

  it('returns stored subscriptions', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, sub('https://a.example/push/1'));
    const list = await listSubscriptions(kv);
    expect(list).toHaveLength(1);
    expect(list[0].endpoint).toBe('https://a.example/push/1');
  });
});

describe('addSubscription', () => {
  it('adds a new subscription', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, sub('https://a.example/push/1'));
    expect(await listSubscriptions(kv)).toHaveLength(1);
  });

  it('deduplicates by endpoint, keeping the latest', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, sub('https://a.example/push/1'));
    const updated = { endpoint: 'https://a.example/push/1', keys: { p256dh: 'new-dh', auth: 'new-auth' } };
    await addSubscription(kv, updated);
    const list = await listSubscriptions(kv);
    expect(list).toHaveLength(1);
    expect(list[0].keys.p256dh).toBe('new-dh');
  });

  it('keeps distinct endpoints separate', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, sub('https://a.example/push/1'));
    await addSubscription(kv, sub('https://b.example/push/2'));
    expect(await listSubscriptions(kv)).toHaveLength(2);
  });
});

describe('removeSubscription', () => {
  it('removes the matching endpoint', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, sub('https://a.example/push/1'));
    await addSubscription(kv, sub('https://b.example/push/2'));
    await removeSubscription(kv, 'https://a.example/push/1');
    const list = await listSubscriptions(kv);
    expect(list).toHaveLength(1);
    expect(list[0].endpoint).toBe('https://b.example/push/2');
  });

  it('is a no-op for an unknown endpoint', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, sub('https://a.example/push/1'));
    await removeSubscription(kv, 'https://z.example/push/99');
    expect(await listSubscriptions(kv)).toHaveLength(1);
  });
});

describe('pruneSubscriptions', () => {
  it('removes all stale endpoints at once', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, sub('https://a.example/push/1'));
    await addSubscription(kv, sub('https://b.example/push/2'));
    await addSubscription(kv, sub('https://c.example/push/3'));
    await pruneSubscriptions(kv, [
      'https://a.example/push/1',
      'https://c.example/push/3',
    ]);
    const list = await listSubscriptions(kv);
    expect(list).toHaveLength(1);
    expect(list[0].endpoint).toBe('https://b.example/push/2');
  });

  it('is a no-op when the stale list is empty', async () => {
    const kv = makeMockKV();
    await addSubscription(kv, sub('https://a.example/push/1'));
    await pruneSubscriptions(kv, []);
    expect(await listSubscriptions(kv)).toHaveLength(1);
  });
});

describe('reminder delivery records', () => {
  it('records delivered kinds without duplicates', async () => {
    const kv = makeMockKV();
    await recordDeliveredReminders(kv, '2026-07-01', ['bodyweight']);
    await recordDeliveredReminders(kv, '2026-07-01', [
      'bodyweight',
      'measurement',
    ]);

    expect(await listDeliveredReminders(kv, '2026-07-01')).toEqual([
      'bodyweight',
      'measurement',
    ]);
  });

  it('isolates delivery records by Local Calendar Date', async () => {
    const kv = makeMockKV();
    await recordDeliveredReminders(kv, '2026-07-01', ['bodyweight']);

    expect(await listDeliveredReminders(kv, '2026-07-02')).toEqual([]);
  });
});
