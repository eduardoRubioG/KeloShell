import type { ApiErrorResponse } from '../../src/contracts/training';
import type { StreaksResponse } from '../../src/contracts/streaks';
import { GoogleSheetsClient } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import {
  computeStreaks,
  type HabitsGateway,
} from '../lib/streaks';
import type { BodyTrackingGateway } from '../lib/body-tracking';
import type { TrainingWeeksGateway } from '../lib/training-weeks';

interface Env {
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  GOOGLE_SPREADSHEET_ID?: string;
  KELOSHELL_META_DB_SHEET?: string;
  LOCAL_AUTH_BYPASS?: string;
}

interface RequiredEnv {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
  GOOGLE_SPREADSHEET_ID: string;
  KELOSHELL_META_DB_SHEET: string;
}

type MainGatewayFactory = (env: RequiredEnv) => BodyTrackingGateway & TrainingWeeksGateway;
type HabitsGatewayFactory = (env: RequiredEnv) => HabitsGateway;

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

  if (!isAuthorized(request, env)) {
    return json(
      { error: 'Private Tool Access is required. Reload and sign in.' },
      401
    );
  }

  const requiredEnv = configuredEnv(env);
  if (!requiredEnv) {
    return json({ error: 'Streaks access is not configured.' }, 500);
  }

  const url = new URL(request.url);
  const todayParam = url.searchParams.get('today');
  const today =
    todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam)
      ? todayParam
      : new Date().toISOString().slice(0, 10);

  try {
    const mainGateway = createMainGateway(requiredEnv);
    const habitsGateway = createHabitsGateway(requiredEnv);
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

function defaultMainGatewayFactory(env: RequiredEnv) {
  return new GoogleSheetsClient({
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY,
    spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
  });
}

function defaultHabitsGatewayFactory(env: RequiredEnv) {
  return new GoogleSheetsClient({
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY,
    spreadsheetId: env.KELOSHELL_META_DB_SHEET,
  });
}

function configuredEnv(env: Env): RequiredEnv | null {
  if (
    !env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !env.GOOGLE_PRIVATE_KEY ||
    !env.GOOGLE_SPREADSHEET_ID ||
    !env.KELOSHELL_META_DB_SHEET
  ) {
    return null;
  }
  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: env.GOOGLE_PRIVATE_KEY,
    GOOGLE_SPREADSHEET_ID: env.GOOGLE_SPREADSHEET_ID,
    KELOSHELL_META_DB_SHEET: env.KELOSHELL_META_DB_SHEET,
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
  body: StreaksResponse | ApiErrorResponse,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}
