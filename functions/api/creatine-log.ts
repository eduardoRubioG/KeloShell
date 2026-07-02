import type { ApiErrorResponse } from '../../src/contracts/training';
import type { StreaksResponse, CreatineLogRequest } from '../../src/contracts/streaks';
import { GoogleSheetsClient } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import {
  computeStreaks,
  logCreatine,
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

  if (!isAuthorized(request, env)) {
    return json(
      { error: 'Private Tool Access is required. Reload and sign in.' },
      401
    );
  }

  const requiredEnv = configuredEnv(env);
  if (!requiredEnv) {
    return json({ error: 'Creatine log access is not configured.' }, 500);
  }

  const payload = await request.json().catch(() => null);
  const creatineRequest = parseCreatineLogRequest(payload);
  if (!creatineRequest) {
    return json({ error: 'A valid creatine log request is required.' }, 400);
  }

  try {
    const mainGateway = createMainGateway(requiredEnv);
    const habitsGateway = createHabitsGateway(requiredEnv);
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
