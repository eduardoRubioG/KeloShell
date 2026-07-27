import { runConnectivityTest } from '../lib/connectivity';
import { GoogleSheetsClient } from '../lib/google-sheets';
import { getSourceCredentials, resolveUserId, type UserResolutionEnv } from '../lib/users';

interface Env extends UserResolutionEnv {
  SHEETS_TARGET_LABEL?: string;
  CONNECTIVITY_SHEET_NAME?: string;
  CONNECTIVITY_SENTINEL?: string;
  ALLOW_CONNECTIVITY_WRITE_TEST?: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
  }

  const userId = resolveUserId(context.request, context.env);
  if (!userId) {
    return json(
      { error: 'Private Tool Access is required. Reload and sign in.' },
      401
    );
  }

  const credentials = getSourceCredentials(userId, context.env);
  if (!credentials) {
    return json(
      { error: 'Missing server configuration for the Source Spreadsheet.' },
      500
    );
  }

  const client = new GoogleSheetsClient(credentials);
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
