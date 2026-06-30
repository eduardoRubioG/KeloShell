import type { ApiErrorResponse } from '../../src/contracts/training';
import type { BodyweightResponse, DailyBodyweightRequest } from '../../src/contracts/body';
import { GoogleSheetsClient } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import {
  BodyweightConflictError,
  writeDailyBodyweight,
  type BodyTrackingGateway,
} from '../lib/body-tracking';

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
  handleDailyBodyweightRequest(context.request, context.env);

export async function handleDailyBodyweightRequest(
  request: Request,
  env: Env,
  createGateway: GatewayFactory = defaultGatewayFactory
): Promise<Response> {
  if (request.method !== 'PUT') {
    return json({ error: 'Method not allowed.' }, 405, { Allow: 'PUT' });
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

  const payload = await request.json().catch(() => null);
  const bodyweightRequest = parseDailyBodyweightRequest(payload);
  if (!bodyweightRequest) {
    return json({ error: 'A valid bodyweight request is required.' }, 400);
  }

  try {
    const response = await writeDailyBodyweight(
      createGateway(requiredEnv),
      bodyweightRequest
    );
    return json(response, 200);
  } catch (error) {
    if (error instanceof BodyweightConflictError) {
      return json({ error: error.message }, 409);
    }
    if (error instanceof SourceSpreadsheetSchemaError) {
      return json(
        { error: 'The Source Spreadsheet structure could not be interpreted.' },
        422
      );
    }
    if (error instanceof TypeError) {
      return json({ error: 'A valid bodyweight request is required.' }, 400);
    }
    return json({ error: 'The bodyweight could not be synced.' }, 502);
  }
}

function parseDailyBodyweightRequest(
  value: unknown
): DailyBodyweightRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (
    (body.operation !== 'save' && body.operation !== 'clear') ||
    typeof body.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
    typeof body.revision !== 'string' ||
    body.revision.length === 0
  ) {
    return null;
  }
  if (body.operation === 'clear') {
    return { operation: 'clear', date: body.date, revision: body.revision };
  }
  if (
    typeof body.weight !== 'number' ||
    !Number.isFinite(body.weight) ||
    body.weight <= 0
  ) {
    return null;
  }
  return {
    operation: 'save',
    date: body.date,
    weight: body.weight,
    revision: body.revision,
  };
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
