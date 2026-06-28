const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const GOOGLE_SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface ValueResponse {
  values?: unknown[][];
}

export interface GoogleSheetsCredentials {
  clientEmail: string;
  privateKey: string;
  spreadsheetId: string;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cachedToken: CachedToken | undefined;

function encodeBase64Url(value: string | ArrayBuffer): string {
  const bytes =
    typeof value === 'string'
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodePrivateKey(privateKey: string): ArrayBuffer {
  const normalized = privateKey.replace(/\\n/g, '\n');
  const body = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

async function createAssertion(
  clientEmail: string,
  privateKey: string,
  now: number
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = encodeBase64Url(
    JSON.stringify({
      iss: clientEmail,
      scope: GOOGLE_SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    })
  );
  const unsignedToken = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodePrivateKey(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${encodeBase64Url(signature)}`;
}

export class GoogleSheetsClient {
  private readonly request: typeof fetch;

  constructor(
    private readonly credentials: GoogleSheetsCredentials,
    request: typeof fetch = fetch,
    private readonly now: () => number = Date.now
  ) {
    this.request = request.bind(globalThis);
  }

  async authenticate(): Promise<void> {
    await this.getAccessToken();
  }

  async readValue(sheetName: string, cell: string): Promise<string> {
    const response = await this.sheetsRequest<ValueResponse>(
      `/values/${this.range(sheetName, cell)}?valueRenderOption=FORMATTED_VALUE`
    );
    const value = response.values?.[0]?.[0];
    return value === undefined || value === null ? '' : String(value);
  }

  async writeValue(
    sheetName: string,
    cell: string,
    value: string
  ): Promise<void> {
    await this.sheetsRequest(
      `/values/${this.range(sheetName, cell)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        body: JSON.stringify({ values: [[value]] }),
      }
    );
  }

  async clearValue(sheetName: string, cell: string): Promise<void> {
    await this.sheetsRequest(`/values/${this.range(sheetName, cell)}:clear`, {
      method: 'POST',
      body: '{}',
    });
  }

  private range(sheetName: string, cell: string): string {
    const escapedSheetName = sheetName.replace(/'/g, "''");
    return encodeURIComponent(`'${escapedSheetName}'!${cell}`);
  }

  private async getAccessToken(): Promise<string> {
    const now = this.now();
    if (cachedToken && cachedToken.expiresAt > now + 60_000) {
      return cachedToken.value;
    }

    const assertion = await createAssertion(
      this.credentials.clientEmail,
      this.credentials.privateKey,
      now
    );
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });
    const response = await this.request(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      throw new Error('Google authentication was rejected.');
    }

    const payload = (await response.json()) as TokenResponse;
    if (!payload.access_token) {
      throw new Error('Google authentication returned no access token.');
    }

    cachedToken = {
      value: payload.access_token,
      expiresAt: now + (payload.expires_in ?? 3600) * 1000,
    };
    return cachedToken.value;
  }

  private async sheetsRequest<T = unknown>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const token = await this.getAccessToken();
    const response = await this.request(
      `${GOOGLE_SHEETS_API}/${encodeURIComponent(
        this.credentials.spreadsheetId
      )}${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          ...init.headers,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Google Sheets request failed with ${response.status}.`);
    }

    return (await response.json()) as T;
  }
}

export function resetGoogleTokenCache(): void {
  cachedToken = undefined;
}
