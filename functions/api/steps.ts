import type { ApiErrorResponse } from '../../src/contracts/training';
import type { StepsResponse } from '../../src/contracts/steps';
import { GoogleSheetsClient } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import { readSteps, type StepsGateway } from '../lib/steps-tracking';

interface Env {
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  KELOSHELL_META_DB_SHEET?: string;
  LOCAL_AUTH_BYPASS?: string;
}

interface RequiredEnv {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;
  KELOSHELL_META_DB_SHEET: string;
}

type StepsGatewayFactory = (env: RequiredEnv) => StepsGateway;

export const onRequest: PagesFunction<Env> = async (context) =>
  handleStepsRequest(context.request, context.env);

export async function handleStepsRequest(
  request: Request,
  env: Env,
  createGateway: StepsGatewayFactory = defaultGatewayFactory
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
    return json({ error: 'Steps tracking is not configured.' }, 500);
  }

  const today = resolveToday(request);

  try {
    const gateway = createGateway(requiredEnv);
    const response = await readSteps(gateway, today);
    return json(response, 200);
  } catch (error) {
    if (error instanceof SourceSpreadsheetSchemaError) {
      return json(
        { error: 'The Steps tab structure could not be interpreted.' },
        422
      );
    }
    return json({ error: 'Steps could not be loaded.' }, 502);
  }
}

export function resolveToday(request: Request): string {
  const todayParam = new URL(request.url).searchParams.get('today');
  return todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam)
    ? todayParam
    : new Date().toISOString().slice(0, 10);
}

function defaultGatewayFactory(env: RequiredEnv): StepsGateway {
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
    !env.KELOSHELL_META_DB_SHEET
  ) {
    return null;
  }
  return {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY: env.GOOGLE_PRIVATE_KEY,
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
  body: StepsResponse | ApiErrorResponse,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}
