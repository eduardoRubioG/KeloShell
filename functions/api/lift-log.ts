import type {
  ApiErrorResponse,
  LiftLogRequest,
  SessionName,
  TrainingWeeksResponse,
} from '../../src/contracts/training';
import { GoogleSheetsClient, type GoogleSheetsCredentials } from '../lib/google-sheets';
import {
  LiftLogConflictError,
  SourceSpreadsheetSchemaError,
  writeLiftLog,
  type TrainingWeeksGateway,
} from '../lib/training-weeks';
import { SESSION_NAMES_BY_USER } from '../lib/config';
import { getSourceCredentials, resolveUserId, type UserResolutionEnv } from '../lib/users';

type Env = UserResolutionEnv;

type GatewayFactory = (credentials: GoogleSheetsCredentials) => TrainingWeeksGateway;

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
  const userId = resolveUserId(request, env);
  if (!userId) {
    return json(
      { error: 'Private Tool Access is required. Reload and sign in.' },
      401
    );
  }
  const credentials = getSourceCredentials(userId, env);
  if (!credentials) {
    return json({ error: 'Source Spreadsheet access is not configured.' }, 500);
  }

  const payload = await request.json().catch(() => null);
  const liftLogRequest = parseLiftLogRequest(payload, SESSION_NAMES_BY_USER[userId]);
  if (!liftLogRequest) {
    return json({ error: 'A valid complete Lift Log is required.' }, 400);
  }

  try {
    const response = await writeLiftLog(
      createGateway(credentials),
      liftLogRequest,
      SESSION_NAMES_BY_USER[userId]
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

function parseLiftLogRequest(
  value: unknown,
  sessionNames: readonly string[]
): LiftLogRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (
    (body.operation !== 'save' && body.operation !== 'clear') ||
    typeof body.weekId !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.weekId) ||
    !isSessionName(body.session, sessionNames) ||
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

function isSessionName(
  value: unknown,
  sessionNames: readonly string[]
): value is SessionName {
  return typeof value === 'string' && sessionNames.includes(value);
}

function defaultGatewayFactory(credentials: GoogleSheetsCredentials): TrainingWeeksGateway {
  return new GoogleSheetsClient(credentials);
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
