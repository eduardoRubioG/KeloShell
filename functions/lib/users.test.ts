import { describe, expect, it } from 'vitest';

import {
  getMetaCredentials,
  getSourceCredentials,
  resolveUserId,
  type UserResolutionEnv,
} from './users';

const env: UserResolutionEnv = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.com',
  GOOGLE_PRIVATE_KEY: 'private-key',
  GOOGLE_SPREADSHEET_ID: 'eduardo-source',
  KELOSHELL_META_DB_SHEET: 'eduardo-meta',
  EMILY_GOOGLE_SPREADSHEET_ID: 'emily-source',
  EMILY_META_DB_SHEET: 'emily-meta',
  EDUARDO_EMAIL: 'ed@example.com',
  EMILY_EMAIL: 'em@example.com',
};

function accessRequest(email: string): Request {
  return new Request('https://app.example.com/api/streaks', {
    headers: {
      'Cf-Access-Jwt-Assertion': 'signed-jwt',
      'Cf-Access-Authenticated-User-Email': email,
    },
  });
}

describe('resolveUserId', () => {
  it('maps the Access email to the matching user', () => {
    expect(resolveUserId(accessRequest('ed@example.com'), env)).toBe('eduardo');
    expect(resolveUserId(accessRequest('em@example.com'), env)).toBe('emily');
  });

  it('is case-insensitive on the Access email', () => {
    expect(resolveUserId(accessRequest('Em@Example.com'), env)).toBe('emily');
  });

  it('returns null for an unknown Access email', () => {
    expect(resolveUserId(accessRequest('stranger@example.com'), env)).toBeNull();
  });

  it('returns null when the Access assertion header is missing', () => {
    const request = new Request('https://app.example.com/api/streaks');
    expect(resolveUserId(request, env)).toBeNull();
  });

  it('defaults to Eduardo on localhost with the auth bypass', () => {
    const request = new Request('http://localhost/api/streaks');
    expect(resolveUserId(request, { ...env, LOCAL_AUTH_BYPASS: 'true' })).toBe('eduardo');
  });

  it('honours an ?as override on localhost with the auth bypass', () => {
    const request = new Request('http://localhost/api/streaks?as=emily');
    expect(resolveUserId(request, { ...env, LOCAL_AUTH_BYPASS: 'true' })).toBe('emily');
  });

  it('does not bypass on localhost without the flag', () => {
    const request = new Request('http://localhost/api/streaks?as=emily');
    expect(resolveUserId(request, env)).toBeNull();
  });

  it('falls back to the default Eduardo email when EDUARDO_EMAIL is unset', () => {
    const { EDUARDO_EMAIL: _omit, ...rest } = env;
    expect(resolveUserId(accessRequest('eduardo.rubio.jr85@gmail.com'), rest)).toBe('eduardo');
  });
});

describe('getSourceCredentials / getMetaCredentials', () => {
  it('resolves each user to their own spreadsheets', () => {
    expect(getSourceCredentials('eduardo', env)).toMatchObject({ spreadsheetId: 'eduardo-source' });
    expect(getMetaCredentials('eduardo', env)).toMatchObject({ spreadsheetId: 'eduardo-meta' });
    expect(getSourceCredentials('emily', env)).toMatchObject({ spreadsheetId: 'emily-source' });
    expect(getMetaCredentials('emily', env)).toMatchObject({ spreadsheetId: 'emily-meta' });
  });

  it('shares the service-account credentials across users', () => {
    expect(getSourceCredentials('emily', env)).toMatchObject({
      clientEmail: 'service@example.com',
      privateKey: 'private-key',
    });
  });

  it('returns null when a user’s spreadsheet is not configured', () => {
    const { EMILY_GOOGLE_SPREADSHEET_ID: _omit, ...rest } = env;
    expect(getSourceCredentials('emily', rest)).toBeNull();
    expect(getMetaCredentials('emily', rest)).not.toBeNull();
  });

  it('returns null when the service account is missing', () => {
    const { GOOGLE_SERVICE_ACCOUNT_EMAIL: _omit, ...rest } = env;
    expect(getSourceCredentials('eduardo', rest)).toBeNull();
  });
});
