interface Env {
  VAPID_PUBLIC_KEY?: string;
  LOCAL_AUTH_BYPASS?: string;
}

export const onRequest: PagesFunction<Env> = (context) =>
  handleVapidPublicKeyRequest(context.request, context.env);

export function handleVapidPublicKeyRequest(request: Request, env: Env): Response {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
  }

  if (!isAuthorized(request, env)) {
    return json({ error: 'Private Tool Access is required. Reload and sign in.' }, 401);
  }

  if (!env.VAPID_PUBLIC_KEY) {
    return json({ error: 'Push notifications are not configured.' }, 503);
  }

  return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200);
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
