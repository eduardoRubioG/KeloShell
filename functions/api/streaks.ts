import type { ApiErrorResponse } from '../../src/contracts/training';
import type { StreaksResponse } from '../../src/contracts/streaks';
import { GoogleSheetsClient, type GoogleSheetsCredentials } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import {
  computeStreaks,
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
  handleStreaksRequest(context.request, context.env);

export async function handleStreaksRequest(
  request: Request,
  env: Env,
  createMainGateway: MainGatewayFactory = defaultMainGatewayFactory,
  createHabitsGateway: HabitsGatewayFactory = defaultHabitsGatewayFactory
): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
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
    return json({ error: 'Streaks access is not configured.' }, 500);
  }

  const url = new URL(request.url);
  const todayParam = url.searchParams.get('today');
  const today =
    todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam)
      ? todayParam
      : new Date().toISOString().slice(0, 10);

  try {
    const mainGateway = createMainGateway(sourceCredentials);
    const habitsGateway = createHabitsGateway(metaCredentials);
    const response = await computeStreaks({
      habitsGateway,
      bodyweightGateway: mainGateway,
      trainingGateway: mainGateway,
      today,
    });
    return json(response, 200);
  } catch (error) {
    if (error instanceof SourceSpreadsheetSchemaError) {
      return json(
        { error: 'The Source Spreadsheet structure could not be interpreted.' },
        422
      );
    }
    return json({ error: 'Streaks could not be loaded.' }, 502);
  }
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
