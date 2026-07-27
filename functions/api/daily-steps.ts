import type { ApiErrorResponse } from '../../src/contracts/training';
import type { StepsResponse, DailyStepsRequest } from '../../src/contracts/steps';
import { GoogleSheetsClient, type GoogleSheetsCredentials } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import {
  StepsConflictError,
  writeDailySteps,
  type StepsGateway,
} from '../lib/steps-tracking';
import { resolveToday } from './steps';
import { getMetaCredentials, resolveUserId, type UserResolutionEnv } from '../lib/users';

type Env = UserResolutionEnv;

type StepsGatewayFactory = (credentials: GoogleSheetsCredentials) => StepsGateway;

export const onRequest: PagesFunction<Env> = async (context) =>
  handleDailyStepsRequest(context.request, context.env);

export async function handleDailyStepsRequest(
  request: Request,
  env: Env,
  createGateway: StepsGatewayFactory = defaultGatewayFactory
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

  const credentials = getMetaCredentials(userId, env);
  if (!credentials) {
    return json({ error: 'Steps tracking is not configured.' }, 500);
  }

  const payload = await request.json().catch(() => null);
  const stepsRequest = parseDailyStepsRequest(payload);
  if (!stepsRequest) {
    return json({ error: 'A valid daily steps request is required.' }, 400);
  }

  const today = resolveToday(request);

  try {
    const gateway = createGateway(credentials);
    const response = await writeDailySteps(gateway, stepsRequest, today);
    return json(response, 200);
  } catch (error) {
    if (error instanceof StepsConflictError) {
      return json({ error: error.message }, 409);
    }
    if (error instanceof SourceSpreadsheetSchemaError) {
      return json(
        { error: 'The Steps tab structure could not be interpreted.' },
        422
      );
    }
    if (error instanceof TypeError) {
      return json({ error: error.message }, 400);
    }
    return json({ error: 'The steps could not be synced.' }, 502);
  }
}

function parseDailyStepsRequest(value: unknown): DailyStepsRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
    typeof body.revision !== 'string'
  ) {
    return null;
  }
  if (body.operation === 'clear') {
    return { operation: 'clear', date: body.date, revision: body.revision };
  }
  if (
    body.operation === 'save' &&
    typeof body.steps === 'number' &&
    Number.isInteger(body.steps) &&
    body.steps > 0
  ) {
    return {
      operation: 'save',
      date: body.date,
      steps: body.steps,
      revision: body.revision,
    };
  }
  return null;
}

function defaultGatewayFactory(credentials: GoogleSheetsCredentials): StepsGateway {
  return new GoogleSheetsClient(credentials);
}

function json(
  body: StepsResponse | ApiErrorResponse,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}
