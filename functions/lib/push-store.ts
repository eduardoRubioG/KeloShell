import type { PushSubscriptionPayload } from '../../src/contracts/push';
import type { ReminderKind } from './reminders';
import type { UserId } from './users';

const REMINDER_DELIVERY_TTL_SECONDS = 45 * 24 * 60 * 60;

const REMINDER_KINDS: readonly ReminderKind[] = [
  'bodyweight',
  'measurement',
  'creatine',
  'steps',
  'steps-yesterday',
];

// Before per-user namespacing, the single user's subscriptions lived under this
// global key. Eduardo's device may still only be registered here after the
// multi-user rollout, so his reads fall back to it until the client re-subscribes
// under the namespaced key (the next addSubscription migrates it automatically).
const LEGACY_SUBSCRIPTIONS_KEY = 'push:subscriptions';

function subscriptionsKey(userId: UserId): string {
  return `push:subscriptions:${userId}`;
}

function parseSubscriptions(raw: string | null): PushSubscriptionPayload[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PushSubscriptionPayload[]) : [];
  } catch {
    return [];
  }
}

function deliveryKey(userId: UserId, localDate: string): string {
  return `push:reminders:${userId}:${localDate}`;
}

export async function listSubscriptions(
  kv: KVNamespace,
  userId: UserId
): Promise<PushSubscriptionPayload[]> {
  const raw = await kv.get(subscriptionsKey(userId));
  if (raw === null && userId === 'eduardo') {
    return parseSubscriptions(await kv.get(LEGACY_SUBSCRIPTIONS_KEY));
  }
  return parseSubscriptions(raw);
}

export async function addSubscription(
  kv: KVNamespace,
  userId: UserId,
  subscription: PushSubscriptionPayload
): Promise<void> {
  const existing = await listSubscriptions(kv, userId);
  const deduped = existing.filter((s) => s.endpoint !== subscription.endpoint);
  await kv.put(subscriptionsKey(userId), JSON.stringify([...deduped, subscription]));
}

export async function removeSubscription(
  kv: KVNamespace,
  userId: UserId,
  endpoint: string
): Promise<void> {
  const existing = await listSubscriptions(kv, userId);
  const filtered = existing.filter((s) => s.endpoint !== endpoint);
  await kv.put(subscriptionsKey(userId), JSON.stringify(filtered));
}

export async function pruneSubscriptions(
  kv: KVNamespace,
  userId: UserId,
  staleEndpoints: string[]
): Promise<void> {
  if (staleEndpoints.length === 0) return;
  const staleSet = new Set(staleEndpoints);
  const existing = await listSubscriptions(kv, userId);
  const pruned = existing.filter((s) => !staleSet.has(s.endpoint));
  await kv.put(subscriptionsKey(userId), JSON.stringify(pruned));
}

export async function listDeliveredReminders(
  kv: KVNamespace,
  userId: UserId,
  localDate: string
): Promise<ReminderKind[]> {
  const raw = await kv.get(deliveryKey(userId, localDate));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((kind): kind is ReminderKind =>
      REMINDER_KINDS.includes(kind as ReminderKind)
    );
  } catch {
    return [];
  }
}

export async function recordDeliveredReminders(
  kv: KVNamespace,
  userId: UserId,
  localDate: string,
  reminders: readonly ReminderKind[]
): Promise<void> {
  const existing = await listDeliveredReminders(kv, userId, localDate);
  const merged = [...new Set([...existing, ...reminders])];
  await kv.put(deliveryKey(userId, localDate), JSON.stringify(merged), {
    expirationTtl: REMINDER_DELIVERY_TTL_SECONDS,
  });
}
