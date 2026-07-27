import type { ApiErrorResponse } from '../../src/contracts/training';
import type { BodyweightResponse } from '../../src/contracts/body';
import { GoogleSheetsClient, type GoogleSheetsCredentials } from '../lib/google-sheets';
import { SourceSpreadsheetSchemaError } from '../lib/config';
import { readBodyweight, type BodyTrackingGateway } from '../lib/body-tracking';
import { getSourceCredentials, resolveUserId, type UserResolutionEnv } from '../lib/users';

type Env = UserResolutionEnv;

type GatewayFactory = (credentials: GoogleSheetsCredentials) => BodyTrackingGateway;

export const onRequest: PagesFunction<Env> = async (context) =>
  handleBodyweightRequest(context.request, context.env);

export async function handleBodyweightRequest(
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
    const response = await readBodyweight(createGateway(credentials));
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
