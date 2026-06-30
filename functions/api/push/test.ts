import type { ApiErrorResponse } from '../../../src/contracts/training';
import type { PushNotificationPayload } from '../../../src/contracts/push';
import { listSubscriptions, pruneSubscriptions } from '../../lib/push-store';
import { sendWebPush, type VapidConfig } from '../../lib/web-push';

interface Env {
  PUSH_KV?: KVNamespace;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  LOCAL_AUTH_BYPASS?: string;
}

export const onRequest: PagesFunction<Env> = (context) =>
  handleTestRequest(context.request, context.env);

export async function handleTestRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
  }

  if (!isAuthorized(request, env)) {
    return json({ error: 'Private Tool Access is required. Reload and sign in.' }, 401);
  }

  const vapid = configuredVapid(env);
  if (!vapid || !env.PUSH_KV) {
    return json({ error: 'Push notifications are not configured.' }, 503);
  }

  const subscriptions = await listSubscriptions(env.PUSH_KV);
  if (subscriptions.length === 0) {
    return json({ error: 'No push subscriptions found.' }, 404);
  }

  const notification: PushNotificationPayload = {
    title: 'KeloShell',
    body: 'Push notifications are working.',
    url: '/',
    tag: 'test',
    vibrate: [100, 50, 100],
  };

  const staleEndpoints: string[] = [];
  const statuses: number[] = [];
  let successCount = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        const result = await sendWebPush(sub, notification, vapid);
        statuses.push(result.status);
        if (result.stale) staleEndpoints.push(sub.endpoint);
        if (result.success) successCount++;
      } catch (err) {
        console.error('[push/test] sendWebPush threw:', err);
        statuses.push(0);
      }
    })
  );

  if (staleEndpoints.length > 0) {
    await pruneSubscriptions(env.PUSH_KV, staleEndpoints);
  }

  if (successCount === 0 && staleEndpoints.length === subscriptions.length) {
    return json({ error: 'All subscriptions were expired and have been removed.', statuses }, 410);
  }

  if (successCount === 0) {
    return json({ error: 'The push could not be delivered.', statuses }, 502);
  }

  return json({ sent: successCount }, 200);
}

function configuredVapid(env: Env): VapidConfig | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}

function isAuthorized(request: Request, env: Env): boolean {
  const hostname = new URL(request.url).hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  return (
    (isLocalhost && env.LOCAL_AUTH_BYPASS === 'true') ||
    request.headers.has('Cf-Access-Jwt-Assertion')
  );
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
