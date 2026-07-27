import type { ApiErrorResponse } from '../../src/contracts/training';
import type { BodyweightResponse, DailyBodyweightRequest } from '../../src/contracts/body';
import { GoogleSheetsClient, type GoogleSheetsCredentials } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import {
  BodyweightConflictError,
  writeDailyBodyweight,
  type BodyTrackingGateway,
} from '../lib/body-tracking';
import { getSourceCredentials, resolveUserId, type UserResolutionEnv } from '../lib/users';

type Env = UserResolutionEnv;

type GatewayFactory = (credentials: GoogleSheetsCredentials) => BodyTrackingGateway;

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
  const bodyweightRequest = parseDailyBodyweightRequest(payload);
  if (!bodyweightRequest) {
    return json({ error: 'A valid bodyweight request is required.' }, 400);
  }

  try {
    const response = await writeDailyBodyweight(
      createGateway(credentials),
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

function defaultGatewayFactory(credentials: GoogleSheetsCredentials): BodyTrackingGateway {
  return new GoogleSheetsClient(credentials);
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
