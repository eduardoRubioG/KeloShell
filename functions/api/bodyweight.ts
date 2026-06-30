import type { ApiErrorResponse } from '../../src/contracts/training';
import type { BodyweightResponse } from '../../src/contracts/body';
import { GoogleSheetsClient } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import { readBodyweight, type BodyTrackingGateway } from '../lib/body-tracking';

interface Env {
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  GOOGLE_SPREADSHEET_ID?: string;
  LOCAL_AUTH_BYPASS?: string;
}

interface RequiredGoogleEnv {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
  GOOGLE_SPREADSHEET_ID: string;
}

type GatewayFactory = (env: RequiredGoogleEnv) => BodyTrackingGateway;

export const onRequest: PagesFunction<Env> = async (context) =>
  handleBodyweightRequest(context.request, context.env);

export async function handleBodyweightRequest(
  request: Request,
  env: Env,
  createGateway: GatewayFactory = defaultGatewayFactory
): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
  }

  if (!isAuthorized(request, env)) {
    return json(
      { error: 'Private Tool Access is required. Reload and sign in.' },
      401
    );
  }

  const requiredEnv = configuredGoogleEnv(env);
  if (!requiredEnv) {
    return json({ error: 'Source Spreadsheet access is not configured.' }, 500);
  }

  try {
    const response = await readBodyweight(createGateway(requiredEnv));
    return json(response, 200);
  } catch (error) {
    if (error instanceof SourceSpreadsheetSchemaError) {
      return json(
        { error: 'The Source Spreadsheet structure could not be interpreted.' },
        422
      );
    }
    return json({ error: 'The Source Spreadsheet could not be read.' }, 502);
  }
}

function defaultGatewayFactory(env: RequiredGoogleEnv): BodyTrackingGateway {
  return new GoogleSheetsClient({
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY,
    spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
  });
}

function configuredGoogleEnv(env: Env): RequiredGoogleEnv | null {
  if (
    !env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !env.GOOGLE_PRIVATE_KEY ||
    !env.GOOGLE_SPREADSHEET_ID
  ) {
    return null;
  }
  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: env.GOOGLE_PRIVATE_KEY,
    GOOGLE_SPREADSHEET_ID: env.GOOGLE_SPREADSHEET_ID,
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
  body: BodyweightResponse | ApiErrorResponse,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}
