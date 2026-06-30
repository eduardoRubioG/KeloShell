import type { ApiErrorResponse } from '../../../src/contracts/training';
import { removeSubscription } from '../../lib/push-store';

interface Env {
  PUSH_KV?: KVNamespace;
  LOCAL_AUTH_BYPASS?: string;
}

export const onRequest: PagesFunction<Env> = (context) =>
  handleUnsubscribeRequest(context.request, context.env);

export async function handleUnsubscribeRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
  }

  if (!isAuthorized(request, env)) {
    return json({ error: 'Private Tool Access is required. Reload and sign in.' }, 401);
  }

  if (!env.PUSH_KV) {
    return json({ error: 'Push notifications are not configured.' }, 503);
  }

  const payload = await request.json().catch(() => null);
  const endpoint = parseEndpoint(payload);
  if (!endpoint) {
    return json({ error: 'A valid endpoint is required.' }, 400);
  }

  await removeSubscription(env.PUSH_KV, endpoint);
  return json({ subscribed: false }, 200);
}

function parseEndpoint(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (typeof body.endpoint !== 'string' || !body.endpoint) return null;
  return body.endpoint;
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
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}

export type { ApiErrorResponse };
