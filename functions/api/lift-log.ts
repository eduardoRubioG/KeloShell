import type {
  ApiErrorResponse,
  LiftLogRequest,
  SessionName,
  TrainingWeeksResponse,
} from '../../src/contracts/training';
import { GoogleSheetsClient } from '../lib/google-sheets';
import {
  LiftLogConflictError,
  SourceSpreadsheetSchemaError,
  writeLiftLog,
  type TrainingWeeksGateway,
} from '../lib/training-weeks';

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

type GatewayFactory = (env: RequiredGoogleEnv) => TrainingWeeksGateway;

export const onRequest: PagesFunction<Env> = async (context) =>
  handleLiftLogRequest(context.request, context.env);

export async function handleLiftLogRequest(
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
  const liftLogRequest = parseLiftLogRequest(payload);
  if (!liftLogRequest) {
    return json({ error: 'A valid complete Lift Log is required.' }, 400);
  }

  try {
    const response = await writeLiftLog(
      createGateway(requiredEnv),
      liftLogRequest
    );
    return json(response, 200);
  } catch (error) {
    if (error instanceof LiftLogConflictError) {
      return json({ error: error.message }, 409);
    }
    if (error instanceof SourceSpreadsheetSchemaError) {
      return json(
        { error: 'The Source Spreadsheet structure could not be interpreted.' },
        422
      );
    }
    if (error instanceof TypeError) {
      return json({ error: 'A valid complete Lift Log is required.' }, 400);
    }
    return json({ error: 'The Lift Log could not be synced.' }, 502);
  }
}

function parseLiftLogRequest(value: unknown): LiftLogRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (
    (body.operation !== 'save' && body.operation !== 'clear') ||
    typeof body.weekId !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.weekId) ||
    !isSessionName(body.session) ||
    typeof body.liftId !== 'string' ||
    body.liftId.length === 0 ||
    typeof body.revision !== 'string' ||
    body.revision.length === 0
  ) {
    return null;
  }
  const base = {
    weekId: body.weekId,
    session: body.session,
    liftId: body.liftId,
    revision: body.revision,
  };
  if (body.operation === 'clear') {
    return { operation: 'clear', ...base };
  }
  if (
    typeof body.weight !== 'number' ||
    !Number.isFinite(body.weight) ||
    body.weight <= 0 ||
    !Array.isArray(body.setResults) ||
    body.setResults.length < 1 ||
    body.setResults.length > 4 ||
    !body.setResults.every(
      (result) => typeof result === 'number' && Number.isInteger(result) && result >= 0
    )
  ) {
    return null;
  }
  return {
    operation: 'save',
    ...base,
    weight: body.weight,
    setResults: body.setResults as number[],
  };
}

function isSessionName(value: unknown): value is SessionName {
  return (
    value === 'Upper A' ||
    value === 'Lower A' ||
    value === 'Upper B' ||
    value === 'Lower B'
  );
}

function defaultGatewayFactory(env: RequiredGoogleEnv): TrainingWeeksGateway {
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
  body: TrainingWeeksResponse | ApiErrorResponse,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}
