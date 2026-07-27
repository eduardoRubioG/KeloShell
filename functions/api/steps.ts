import type { ApiErrorResponse } from '../../src/contracts/training';
import type { StepsResponse } from '../../src/contracts/steps';
import { GoogleSheetsClient, type GoogleSheetsCredentials } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import { readSteps, type StepsGateway } from '../lib/steps-tracking';
import { getMetaCredentials, resolveUserId, type UserResolutionEnv } from '../lib/users';

type Env = UserResolutionEnv;

type StepsGatewayFactory = (credentials: GoogleSheetsCredentials) => StepsGateway;

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

  const today = resolveToday(request);

  try {
    const gateway = createGateway(credentials);
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
