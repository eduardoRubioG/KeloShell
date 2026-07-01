import type { PushSubscriptionPayload } from '../../src/contracts/push';
import type { ReminderKind } from './reminders';
import { PUSH_SUBSCRIPTIONS_KEY, REMINDER_DELIVERY_KEY_PREFIX } from './config';

const REMINDER_DELIVERY_TTL_SECONDS = 45 * 24 * 60 * 60;

export async function listSubscriptions(kv: KVNamespace): Promise<PushSubscriptionPayload[]> {
  const raw = await kv.get(PUSH_SUBSCRIPTIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PushSubscriptionPayload[]) : [];
  } catch {
    return [];
  }
}

export async function addSubscription(
  kv: KVNamespace,
  subscription: PushSubscriptionPayload
): Promise<void> {
  const existing = await listSubscriptions(kv);
  const deduped = existing.filter((s) => s.endpoint !== subscription.endpoint);
  await kv.put(PUSH_SUBSCRIPTIONS_KEY, JSON.stringify([...deduped, subscription]));
}

export async function removeSubscription(kv: KVNamespace, endpoint: string): Promise<void> {
  const existing = await listSubscriptions(kv);
  const filtered = existing.filter((s) => s.endpoint !== endpoint);
  await kv.put(PUSH_SUBSCRIPTIONS_KEY, JSON.stringify(filtered));
}

export async function pruneSubscriptions(
  kv: KVNamespace,
  staleEndpoints: string[]
): Promise<void> {
  if (staleEndpoints.length === 0) return;
  const staleSet = new Set(staleEndpoints);
  const existing = await listSubscriptions(kv);
  const pruned = existing.filter((s) => !staleSet.has(s.endpoint));
  await kv.put(PUSH_SUBSCRIPTIONS_KEY, JSON.stringify(pruned));
}

export async function listDeliveredReminders(
  kv: KVNamespace,
  localDate: string
): Promise<ReminderKind[]> {
  const raw = await kv.get(`${REMINDER_DELIVERY_KEY_PREFIX}${localDate}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (kind): kind is ReminderKind => kind === 'bodyweight' || kind === 'measurement'
    );
  } catch {
    return [];
  }
}

export async function recordDeliveredReminders(
  kv: KVNamespace,
  localDate: string,
  reminders: readonly ReminderKind[]
): Promise<void> {
  const existing = await listDeliveredReminders(kv, localDate);
  const merged = [...new Set([...existing, ...reminders])];
  await kv.put(
    `${REMINDER_DELIVERY_KEY_PREFIX}${localDate}`,
    JSON.stringify(merged),
    { expirationTtl: REMINDER_DELIVERY_TTL_SECONDS }
  );
}
