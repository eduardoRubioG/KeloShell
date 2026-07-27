import type { ApiErrorResponse } from '../../src/contracts/training';
import type { StreaksResponse, CreatineLogRequest } from '../../src/contracts/streaks';
import { GoogleSheetsClient, type GoogleSheetsCredentials } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import {
  computeStreaks,
  logCreatine,
  type HabitsGateway,
} from '../lib/streaks';
import type { BodyTrackingGateway } from '../lib/body-tracking';
import type { TrainingWeeksGateway } from '../lib/training-weeks';
import {
  getMetaCredentials,
  getSourceCredentials,
  resolveUserId,
  type UserResolutionEnv,
} from '../lib/users';

type Env = UserResolutionEnv;

type MainGatewayFactory = (
  credentials: GoogleSheetsCredentials
) => BodyTrackingGateway & TrainingWeeksGateway;
type HabitsGatewayFactory = (credentials: GoogleSheetsCredentials) => HabitsGateway;

export const onRequest: PagesFunction<Env> = async (context) =>
  handleCreatineLogRequest(context.request, context.env);

export async function handleCreatineLogRequest(
  request: Request,
  env: Env,
  createMainGateway: MainGatewayFactory = defaultMainGatewayFactory,
  createHabitsGateway: HabitsGatewayFactory = defaultHabitsGatewayFactory
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

  const sourceCredentials = getSourceCredentials(userId, env);
  const metaCredentials = getMetaCredentials(userId, env);
  if (!sourceCredentials || !metaCredentials) {
    return json({ error: 'Creatine log access is not configured.' }, 500);
  }

  const payload = await request.json().catch(() => null);
  const creatineRequest = parseCreatineLogRequest(payload);
  if (!creatineRequest) {
    return json({ error: 'A valid creatine log request is required.' }, 400);
  }

  try {
    const mainGateway = createMainGateway(sourceCredentials);
    const habitsGateway = createHabitsGateway(metaCredentials);
    await logCreatine(habitsGateway, creatineRequest);
    const response = await computeStreaks({
      habitsGateway,
      bodyweightGateway: mainGateway,
      trainingGateway: mainGateway,
      today: creatineRequest.date,
    });
    return json(response, 200);
  } catch (error) {
    if (error instanceof SourceSpreadsheetSchemaError) {
      return json(
        { error: 'The Source Spreadsheet structure could not be interpreted.' },
        422
      );
    }
    return json({ error: 'The creatine log could not be synced.' }, 502);
  }
}

function parseCreatineLogRequest(value: unknown): CreatineLogRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (
    (body.operation !== 'log' && body.operation !== 'unlog') ||
    typeof body.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.date)
  ) {
    return null;
  }
  return { operation: body.operation, date: body.date };
}

function defaultMainGatewayFactory(credentials: GoogleSheetsCredentials) {
  return new GoogleSheetsClient(credentials);
}

function defaultHabitsGatewayFactory(credentials: GoogleSheetsCredentials) {
  return new GoogleSheetsClient(credentials);
}

function json(
  body: StreaksResponse | ApiErrorResponse,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}
