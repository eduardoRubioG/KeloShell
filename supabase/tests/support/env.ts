import { execFileSync } from 'node:child_process';

/**
 * Connection details for the local Supabase stack. These are the CLI's local
 * defaults printed by `npx supabase status -o env`, not secrets.
 */
export interface LocalSupabaseEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * Refuses any Supabase URL whose host isn't the local stack. The isolation
 * suite creates and signs in fake users with the service role, so it must
 * never point at a hosted project.
 */
export function assertLocalSupabaseUrl(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(
      `Isolation suite refused to run: "${url}" is not a valid Supabase URL. ` +
        'It only runs against the local stack (npx supabase start).'
    );
  }
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Isolation suite refused to run: the Supabase URL host is "${hostname}", ` +
        'but it must be 127.0.0.1 or localhost. It only runs against the local ' +
        'stack (npx supabase start), never a hosted project.'
    );
  }
}

/** Parses the KEY="value" lines printed by `supabase status -o env`. */
export function parseStatusEnv(output: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    vars[match[1]] = match[2].replace(/^"(.*)"$/, '$1');
  }
  return vars;
}

type Env = Record<string, string | undefined>;

/**
 * Resolves the local stack's URL and keys, in order of preference:
 *
 * 1. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, if
 *    any of them is set (then all three are required).
 * 2. `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY`, the names `supabase status
 *    -o env` prints, which CI exports into the job's environment.
 * 3. Otherwise, shells out to `npx supabase status -o env` so a developer only
 *    needs `npx supabase start` and `npm run test:isolation`.
 *
 * The result always passes the localhost guard.
 */
export function resolveLocalSupabaseEnv(
  env: Env = process.env,
  readStatus: () => string = readSupabaseStatus
): LocalSupabaseEnv {
  const resolved = fromEnv(env) ?? fromStatus(parseStatusEnv(readStatus()));
  assertLocalSupabaseUrl(resolved.url);
  return resolved;
}

function fromEnv(env: Env): LocalSupabaseEnv | undefined {
  const explicit = {
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (explicit.url || explicit.anonKey || explicit.serviceRoleKey) {
    return requireAll(
      explicit,
      'SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY'
    );
  }
  if (env.API_URL && env.ANON_KEY && env.SERVICE_ROLE_KEY) {
    return fromStatus(env);
  }
  return undefined;
}

function fromStatus(vars: Env): LocalSupabaseEnv {
  return requireAll(
    {
      url: vars.API_URL,
      anonKey: vars.ANON_KEY,
      serviceRoleKey: vars.SERVICE_ROLE_KEY,
    },
    'API_URL, ANON_KEY and SERVICE_ROLE_KEY from `supabase status -o env`'
  );
}

function requireAll(
  candidate: Partial<LocalSupabaseEnv>,
  names: string
): LocalSupabaseEnv {
  const { url, anonKey, serviceRoleKey } = candidate;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(`Isolation suite needs all of ${names}.`);
  }
  return { url, anonKey, serviceRoleKey };
}

function readSupabaseStatus(): string {
  try {
    return execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (cause) {
    throw new Error(
      'Isolation suite could not read the local Supabase stack. Start it with ' +
        '`npx supabase start`, then run `npm run test:isolation` again.',
      { cause }
    );
  }
}
