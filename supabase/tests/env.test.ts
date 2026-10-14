import { describe, expect, it } from 'vitest';

import {
  assertLocalDbUrl,
  assertLocalSupabaseUrl,
  resolveLocalDbUrl,
  parseStatusEnv,
  resolveLocalSupabaseEnv,
} from './support/env';

const statusOutput = [
  'ANON_KEY="anon"',
  'API_URL="http://127.0.0.1:54321"',
  'SERVICE_ROLE_KEY="service"',
].join('\n');

describe('localhost guard', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321'])(
    'accepts the local stack at %s',
    (url) => {
      expect(() => assertLocalSupabaseUrl(url)).not.toThrow();
    }
  );

  it.each([
    'https://abcdefghijklmnop.supabase.co',
    'http://10.0.0.5:54321',
    'http://localhost.example.com:54321',
    'not a url',
  ])('refuses %s with a clear message', (url) => {
    expect(() => assertLocalSupabaseUrl(url)).toThrow(
      /Isolation suite refused to run/
    );
  });

  it('refuses a hosted URL before anything reads the stack', () => {
    const readStatus = () => {
      throw new Error('should not be called');
    };
    expect(() =>
      resolveLocalSupabaseEnv(
        {
          SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
          SUPABASE_ANON_KEY: 'anon',
          SUPABASE_SERVICE_ROLE_KEY: 'service',
        },
        readStatus
      )
    ).toThrow(/must be 127\.0\.0\.1 or localhost/);
  });
});

describe('resolving the local stack', () => {
  it('reads `supabase status -o env` when nothing is exported', () => {
    expect(resolveLocalSupabaseEnv({}, () => statusOutput)).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'anon',
      serviceRoleKey: 'service',
    });
  });

  it('uses the status names when CI exported them', () => {
    expect(
      resolveLocalSupabaseEnv(parseStatusEnv(statusOutput), () => '')
    ).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'anon',
      serviceRoleKey: 'service',
    });
  });

  it('requires all three explicit variables once any is set', () => {
    expect(() =>
      resolveLocalSupabaseEnv(
        { SUPABASE_URL: 'http://127.0.0.1:54321' },
        () => statusOutput
      )
    ).toThrow(/needs all of SUPABASE_URL/);
  });
});

describe('database URL guard', () => {
  it('accepts the local database and refuses a remote one', () => {
    expect(() =>
      assertLocalDbUrl(
        'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
      )
    ).not.toThrow();
    expect(() =>
      assertLocalDbUrl('postgresql://u:p@db.abc.supabase.co:5432/postgres')
    ).toThrow(/Isolation suite refused to run/);
  });

  it('prefers DB_URL from the environment, then status, then the default', () => {
    const fromEnv = 'postgresql://u:p@localhost:5432/db';
    expect(resolveLocalDbUrl({ DB_URL: fromEnv }, () => '')).toBe(fromEnv);
    expect(
      resolveLocalDbUrl({}, () => 'DB_URL="postgresql://u:p@127.0.0.1:1/db"')
    ).toBe('postgresql://u:p@127.0.0.1:1/db');
    expect(
      resolveLocalDbUrl({}, () => {
        throw new Error('no stack');
      })
    ).toContain('127.0.0.1:54322');
  });

  it('refuses a remote DB_URL from the environment', () => {
    expect(() =>
      resolveLocalDbUrl(
        { DB_URL: 'postgresql://u:p@db.example.com/db' },
        () => ''
      )
    ).toThrow(/Isolation suite refused to run/);
  });
});
