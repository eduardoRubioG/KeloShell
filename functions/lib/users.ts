import type { GoogleSheetsCredentials } from './google-sheets';

/**
 * KeloShell serves exactly two people, each with their own source-of-truth
 * spreadsheets. Cloudflare Access authenticates the request and forwards the
 * signed-in address in `Cf-Access-Authenticated-User-Email`; this module maps
 * that address to a user and to that user's spreadsheet credentials.
 *
 * The shared Google service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` /
 * `GOOGLE_PRIVATE_KEY`) is granted Editor on all four spreadsheets; only the
 * spreadsheet IDs differ per user.
 */

export type UserId = 'eduardo' | 'emily';

export const ALL_USER_IDS: readonly UserId[] = ['eduardo', 'emily'];

const DEFAULT_EDUARDO_EMAIL = 'eduardo.rubio.jr85@gmail.com';

interface UserProfile {
  id: UserId;
  displayName: string;
  /** Env var holding this user's Cloudflare Access email. */
  emailVar: 'EDUARDO_EMAIL' | 'EMILY_EMAIL';
  /** Fallback email when the env var is unset. */
  defaultEmail?: string;
  /** Env var holding this user's coach training-source spreadsheet ID. */
  spreadsheetIdVar: 'GOOGLE_SPREADSHEET_ID' | 'EMILY_GOOGLE_SPREADSHEET_ID';
  /** Env var holding this user's app-owned meta DB spreadsheet ID. */
  metaDbSheetVar: 'KELOSHELL_META_DB_SHEET' | 'EMILY_META_DB_SHEET';
}

export const USER_PROFILES: Record<UserId, UserProfile> = {
  eduardo: {
    id: 'eduardo',
    displayName: 'Eduardo',
    emailVar: 'EDUARDO_EMAIL',
    defaultEmail: DEFAULT_EDUARDO_EMAIL,
    spreadsheetIdVar: 'GOOGLE_SPREADSHEET_ID',
    metaDbSheetVar: 'KELOSHELL_META_DB_SHEET',
  },
  emily: {
    id: 'emily',
    displayName: 'Emily',
    emailVar: 'EMILY_EMAIL',
    spreadsheetIdVar: 'EMILY_GOOGLE_SPREADSHEET_ID',
    metaDbSheetVar: 'EMILY_META_DB_SHEET',
  },
};

export interface UserResolutionEnv {
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  GOOGLE_SPREADSHEET_ID?: string;
  KELOSHELL_META_DB_SHEET?: string;
  EMILY_GOOGLE_SPREADSHEET_ID?: string;
  EMILY_META_DB_SHEET?: string;
  EDUARDO_EMAIL?: string;
  EMILY_EMAIL?: string;
  LOCAL_AUTH_BYPASS?: string;
}

function profileEmail(profile: UserProfile, env: UserResolutionEnv): string | undefined {
  const configured = env[profile.emailVar];
  return (configured ?? profile.defaultEmail)?.trim().toLowerCase() || undefined;
}

/**
 * Identify the signed-in user, or `null` if the request is not authorized.
 *
 * On localhost with `LOCAL_AUTH_BYPASS`, defaults to `eduardo` but honours an
 * `?as=emily` query param so both users can be exercised locally. On deployed
 * environments, matches the Cloudflare Access email against the configured
 * per-user addresses.
 */
export function resolveUserId(request: Request, env: UserResolutionEnv): UserId | null {
  const url = new URL(request.url);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  if (isLocalhost && env.LOCAL_AUTH_BYPASS === 'true') {
    const as = url.searchParams.get('as');
    return as === 'emily' || as === 'eduardo' ? as : 'eduardo';
  }

  if (!request.headers.has('Cf-Access-Jwt-Assertion')) {
    return null;
  }

  const email = request.headers.get('Cf-Access-Authenticated-User-Email')?.trim().toLowerCase();
  if (!email) return null;

  for (const id of ALL_USER_IDS) {
    if (profileEmail(USER_PROFILES[id], env) === email) return id;
  }
  return null;
}

function credentials(
  env: UserResolutionEnv,
  spreadsheetId: string | undefined
): GoogleSheetsCredentials | null {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !spreadsheetId) {
    return null;
  }
  return {
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_PRIVATE_KEY,
    spreadsheetId,
  };
}

/** Credentials for the user's coach-owned training-source spreadsheet. */
export function getSourceCredentials(
  userId: UserId,
  env: UserResolutionEnv
): GoogleSheetsCredentials | null {
  return credentials(env, env[USER_PROFILES[userId].spreadsheetIdVar]);
}

/** Credentials for the user's app-owned meta DB spreadsheet. */
export function getMetaCredentials(
  userId: UserId,
  env: UserResolutionEnv
): GoogleSheetsCredentials | null {
  return credentials(env, env[USER_PROFILES[userId].metaDbSheetVar]);
}
