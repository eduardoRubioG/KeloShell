import type { ApiErrorResponse } from '../../src/contracts/training';
import type {
  MeasurementCheckInSaveRequest,
  MeasurementsResponse,
} from '../../src/contracts/measurements';
import { GoogleSheetsClient, type GoogleSheetsCredentials } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import {
  MeasurementCheckInConflictError,
  saveMeasurementCheckIn,
  type MeasurementTrackingGateway,
} from '../lib/measurement-tracking';
import { getSourceCredentials, resolveUserId, type UserResolutionEnv } from '../lib/users';

type Env = UserResolutionEnv;

type GatewayFactory = (credentials: GoogleSheetsCredentials) => MeasurementTrackingGateway;

export const onRequest: PagesFunction<Env> = async (context) =>
  handleMeasurementCheckInRequest(context.request, context.env);

export async function handleMeasurementCheckInRequest(
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
  const checkInRequest = parseMeasurementCheckInSaveRequest(payload);
  if (!checkInRequest) {
    return json({ error: 'A valid measurement check-in request is required.' }, 400);
  }

  try {
    const response = await saveMeasurementCheckIn(
      createGateway(credentials),
      checkInRequest
    );
    return json(response, 200);
  } catch (error) {
    if (error instanceof MeasurementCheckInConflictError) {
      return json({ error: error.message }, 409);
    }
    if (error instanceof SourceSpreadsheetSchemaError) {
      return json(
        { error: 'The Source Spreadsheet structure could not be interpreted.' },
        422
      );
    }
    if (error instanceof TypeError) {
      return json({ error: 'A valid measurement check-in request is required.' }, 400);
    }
    return json({ error: 'The measurement check-in could not be synced.' }, 502);
  }
}

function parseMeasurementCheckInSaveRequest(
  value: unknown
): MeasurementCheckInSaveRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
    typeof body.revision !== 'string' ||
    body.revision.length === 0 ||
    !body.values ||
    typeof body.values !== 'object'
  ) {
    return null;
  }

  const values: Record<string, number> = {};
  for (const [fieldId, rawValue] of Object.entries(body.values as Record<string, unknown>)) {
    if (typeof fieldId !== 'string' || fieldId.length === 0) {
      return null;
    }
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue <= 0) {
      return null;
    }
    values[fieldId] = rawValue;
  }

  if (Object.keys(values).length === 0) {
    return null;
  }

  return {
    date: body.date,
    revision: body.revision,
    values,
  };
}

function defaultGatewayFactory(
  credentials: GoogleSheetsCredentials
): MeasurementTrackingGateway {
  return new GoogleSheetsClient(credentials);
}

function json(
  body: MeasurementsResponse | ApiErrorResponse,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}
