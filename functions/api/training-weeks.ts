import type {
  ApiErrorResponse,
  TrainingWeeksResponse,
} from '../../src/contracts/training';
import { GoogleSheetsClient, type GoogleSheetsCredentials } from '../lib/google-sheets';
import {
  readTrainingWeeks,
  SourceSpreadsheetSchemaError,
  type TrainingWeeksGateway,
} from '../lib/training-weeks';
import { getSourceCredentials, resolveUserId, type UserResolutionEnv } from '../lib/users';

type Env = UserResolutionEnv;

type GatewayFactory = (credentials: GoogleSheetsCredentials) => TrainingWeeksGateway;

export const onRequest: PagesFunction<Env> = async (context) =>
  handleTrainingWeeksRequest(context.request, context.env);

export async function handleTrainingWeeksRequest(
  request: Request,
  env: Env,
  createGateway: GatewayFactory = defaultGatewayFactory
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

  const credentials = getSourceCredentials(userId, env);
  if (!credentials) {
    return json({ error: 'Source Spreadsheet access is not configured.' }, 500);
  }

  try {
    const response = await readTrainingWeeks(createGateway(credentials));
    return json(response, 200);
  } catch (error) {
    if (error instanceof SourceSpreadsheetSchemaError) {
      return json(
        { error: 'The Source Spreadsheet structure could not be interpreted.' },
        422
      );
    }
    return json({ error: 'The Source Spreadsheet could not be read.' }, 502);
  }
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
