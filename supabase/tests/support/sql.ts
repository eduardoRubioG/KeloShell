import { spawnSync } from 'node:child_process';

import { resolveLocalDbUrl } from './env';

export interface SqlResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** The SQLSTATE of the failing statement, when there was one. */
  sqlstate?: string;
}

export interface SqlSession {
  /** Database role to `set role` to, e.g. `service_role` or `authenticated`. */
  role: 'service_role' | 'authenticated' | 'anon';
  /** For `authenticated`: the Sign-In Account id, as the JWT `sub` claim. */
  sub?: string;
}

let dbUrl: string | undefined;

/**
 * Runs SQL through psql in one session as a database role, the way PostgREST
 * would: `set role`, then the JWT claims that `auth.uid()` reads. For things
 * supabase-js can't send (TRUNCATE, CREATE TRIGGER) and for acting as a user
 * over SQL. The statements run in one transaction, so a failure leaves no
 * partial state. Requires `psql` on PATH.
 */
export function runSql(sql: string, session: SqlSession): SqlResult {
  dbUrl ??= resolveLocalDbUrl();
  const claims = JSON.stringify({
    role: session.role,
    ...(session.sub ? { sub: session.sub } : {}),
  });
  const script = [
    'begin;',
    `set local role ${session.role};`,
    `select set_config('request.jwt.claims', '${claims}', true);`,
    sql,
    'commit;',
  ].join('\n');
  const result = spawnSync(
    'psql',
    [dbUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
    { input: script, encoding: 'utf8' }
  );
  if (result.error) {
    throw new Error(
      `Could not run psql (is it installed?): ${result.error.message}`
    );
  }
  const stderr = result.stderr ?? '';
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr,
    sqlstate: /ERROR:\s+([0-9A-Z]{5}):/.exec(stderr)?.[1],
  };
}
