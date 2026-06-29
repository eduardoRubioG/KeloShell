import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GoogleSheetsClient, resetGoogleTokenCache } from './google-sheets';

async function privateKeyPem(): Promise<string> {
  const pair = (await webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  const key = await webcrypto.subtle.exportKey('pkcs8', pair.privateKey);
  const body = Buffer.from(key).toString('base64').match(/.{1,64}/g)?.join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

describe('GoogleSheetsClient', () => {
  beforeEach(() => resetGoogleTokenCache());

  it('invokes fetch with the global runtime receiver', async () => {
    let receiver: unknown;
    const request = vi.fn<typeof fetch>(function (this: unknown) {
      receiver = this;
      return Promise.resolve(
        Response.json({ access_token: 'token-value', expires_in: 3600 })
      );
    });
    const client = new GoogleSheetsClient(
      {
        clientEmail: 'test@example.iam.gserviceaccount.com',
        privateKey: await privateKeyPem(),
        spreadsheetId: 'replica-id',
      },
      request,
      () => 1_700_000_000_000
    );

    await client.authenticate();

    expect(receiver).toBe(globalThis);
  });

  it('signs a service-account assertion and reuses the short-lived token', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ access_token: 'token-value', expires_in: 3600 })
    );
    const client = new GoogleSheetsClient(
      {
        clientEmail: 'test@example.iam.gserviceaccount.com',
        privateKey: await privateKeyPem(),
        spreadsheetId: 'replica-id',
      },
      request,
      () => 1_700_000_000_000
    );

    await client.authenticate();
    await client.authenticate();

    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'
    );
    expect(String(init?.body).split('assertion=')[1]?.split('.')).toHaveLength(3);
  });

  it('reads a value through the Sheets REST API without leaking credentials in the URL', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: 'token-value', expires_in: 3600 })
      )
      .mockResolvedValueOnce(Response.json({ values: [['EXPECTED']] }));
    const client = new GoogleSheetsClient(
      {
        clientEmail: 'test@example.iam.gserviceaccount.com',
        privateKey: await privateKeyPem(),
        spreadsheetId: 'replica-id',
      },
      request,
      () => 1_700_000_000_000
    );

    const value = await client.readValue('_PWA_CONNECTIVITY', 'A1');

    expect(value).toBe('EXPECTED');
    expect(String(request.mock.calls[1][0])).toContain(
      '/replica-id/values/'
    );
    expect(String(request.mock.calls[1][0])).not.toContain('PRIVATE');
    expect(request.mock.calls[1][1]?.headers).toMatchObject({
      authorization: 'Bearer token-value',
    });
  });

  it('batch reads ranges with an explicit value rendering mode', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: 'token-value', expires_in: 3600 })
      )
      .mockResolvedValueOnce(
        Response.json({
          valueRanges: [
            { values: [['Upper A']] },
            { values: [['Lower A']] },
          ],
        })
      );
    const client = new GoogleSheetsClient(
      {
        clientEmail: 'test@example.iam.gserviceaccount.com',
        privateKey: await privateKeyPem(),
        spreadsheetId: 'replica-id',
      },
      request,
      () => 1_700_000_000_000
    );

    const values = await client.readRanges(
      ["'Upper A'!A:AP", "'Lower A'!A:AP"],
      'UNFORMATTED_VALUE'
    );

    expect(values).toEqual([[['Upper A']], [['Lower A']]]);
    const url = new URL(String(request.mock.calls[1][0]));
    expect(url.pathname).toContain('/replica-id/values:batchGet');
    expect(url.searchParams.getAll('ranges')).toEqual([
      "'Upper A'!A:AP",
      "'Lower A'!A:AP",
    ]);
    expect(url.searchParams.get('valueRenderOption')).toBe(
      'UNFORMATTED_VALUE'
    );
  });

  it('writes and clears a contiguous Lift Log range', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: 'token-value', expires_in: 3600 })
      )
      .mockResolvedValueOnce(Response.json({ updatedCells: 5 }))
      .mockResolvedValueOnce(Response.json({ clearedRange: "'Upper A'!B7:F7" }));
    const client = new GoogleSheetsClient(
      {
        clientEmail: 'test@example.iam.gserviceaccount.com',
        privateKey: await privateKeyPem(),
        spreadsheetId: 'replica-id',
      },
      request,
      () => 1_700_000_000_000
    );

    await client.writeRange('Upper A', 'B7:F7', [100, 8, 8, 7, '']);
    await client.clearRange('Upper A', 'B7:F7');

    expect(request.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ values: [[100, 8, 8, 7, '']] }),
    });
    expect(String(request.mock.calls[1][0])).toContain('valueInputOption=RAW');
    expect(request.mock.calls[2][1]).toMatchObject({
      method: 'POST',
      body: '{}',
    });
    expect(String(request.mock.calls[2][0])).toContain(
      "'Upper%20A'!B7%3AF7:clear"
    );
  });
});
