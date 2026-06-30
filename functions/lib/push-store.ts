import type { PushSubscriptionPayload } from '../../src/contracts/push';
import { PUSH_SUBSCRIPTIONS_KEY } from './config';

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
