import type {
  PushSubscribeRequest,
  PushSubscribeResponse,
  PushSubscriptionPayload,
} from '../../../contracts/push';
import type { ApiErrorResponse } from '../../../contracts/training';

export async function fetchVapidPublicKey(): Promise<{ publicKey: string }> {
  const response = await fetch('/api/push/vapid-public-key', {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    throw new Error(payload?.error ?? 'Push configuration could not be loaded.');
  }
  return (await response.json()) as { publicKey: string };
}

export async function subscribePush(
  subscription: PushSubscriptionPayload
): Promise<PushSubscribeResponse> {
  const body: PushSubscribeRequest = { subscription };
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    throw new Error(payload?.error ?? 'The subscription could not be saved.');
  }
  return (await response.json()) as PushSubscribeResponse;
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  const response = await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    throw new Error(payload?.error ?? 'The subscription could not be removed.');
  }
}

export async function sendTestPush(): Promise<void> {
  const response = await fetch('/api/push/test', {
    method: 'POST',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    throw new Error(payload?.error ?? 'The test notification could not be sent.');
  }
}
