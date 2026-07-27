import type { PushSubscriptionPayload, PushSubscribeResponse } from '../../../src/contracts/push';
import type { ApiErrorResponse } from '../../../src/contracts/training';
import { addSubscription } from '../../lib/push-store';
import { resolveUserId, type UserResolutionEnv } from '../../lib/users';

interface Env extends UserResolutionEnv {
  PUSH_KV?: KVNamespace;
}

export const onRequest: PagesFunction<Env> = (context) =>
  handleSubscribeRequest(context.request, context.env);

export async function handleSubscribeRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
  }

  const userId = resolveUserId(request, env);
  if (!userId) {
    return json({ error: 'Private Tool Access is required. Reload and sign in.' }, 401);
  }

  if (!env.PUSH_KV) {
    return json({ error: 'Push notifications are not configured.' }, 503);
  }

  const payload = await request.json().catch(() => null);
  const subscription = parseSubscription(payload);
  if (!subscription) {
    return json({ error: 'A valid push subscription is required.' }, 400);
  }

  await addSubscription(env.PUSH_KV, userId, subscription);
  return json({ subscribed: true }, 200);
}

function parseSubscription(value: unknown): PushSubscriptionPayload | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const sub = body.subscription;
  if (!sub || typeof sub !== 'object') return null;
  const s = sub as Record<string, unknown>;
  if (typeof s.endpoint !== 'string' || !s.endpoint) return null;
  if (!s.keys || typeof s.keys !== 'object') return null;
  const keys = s.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  return { endpoint: s.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function json(
  body: PushSubscribeResponse | ApiErrorResponse,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}
