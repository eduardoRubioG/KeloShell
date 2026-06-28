import { runConnectivityTest } from '../lib/connectivity';
import { GoogleSheetsClient } from '../lib/google-sheets';

interface Env {
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  GOOGLE_SPREADSHEET_ID?: string;
  SHEETS_TARGET_LABEL?: string;
  CONNECTIVITY_SHEET_NAME?: string;
  CONNECTIVITY_SENTINEL?: string;
  ALLOW_CONNECTIVITY_WRITE_TEST?: string;
  LOCAL_AUTH_BYPASS?: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
  }

  if (!isAuthorized(context.request, context.env)) {
    return json(
      { error: 'Private Tool Access is required. Reload and sign in.' },
      401
    );
  }

  const missing = [
    ['GOOGLE_SERVICE_ACCOUNT_EMAIL', context.env.GOOGLE_SERVICE_ACCOUNT_EMAIL],
    ['GOOGLE_PRIVATE_KEY', context.env.GOOGLE_PRIVATE_KEY],
    ['GOOGLE_SPREADSHEET_ID', context.env.GOOGLE_SPREADSHEET_ID],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    return json(
      {
        error: `Missing server configuration: ${missing
          .map(([name]) => name)
          .join(', ')}.`,
      },
      500
    );
  }

  const client = new GoogleSheetsClient({
    clientEmail: context.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    privateKey: context.env.GOOGLE_PRIVATE_KEY!,
    spreadsheetId: context.env.GOOGLE_SPREADSHEET_ID!,
  });
  const report = await runConnectivityTest(
    {
      target: context.env.SHEETS_TARGET_LABEL ?? 'replica',
      sheetName: context.env.CONNECTIVITY_SHEET_NAME ?? '_PWA_CONNECTIVITY',
      sentinel:
        context.env.CONNECTIVITY_SENTINEL ?? 'KELOSHELL_CONNECTIVITY_V1',
      allowWrite: context.env.ALLOW_CONNECTIVITY_WRITE_TEST === 'true',
    },
    client
  );

  return json(report, 200);
};

function isAuthorized(request: Request, env: Env): boolean {
  const hostname = new URL(request.url).hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocalhost && env.LOCAL_AUTH_BYPASS === 'true') {
    return true;
  }

  return request.headers.has('Cf-Access-Jwt-Assertion');
}

function json(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
