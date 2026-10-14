import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { LocalSupabaseEnv } from './env';

/** Password for every fake Sign-In Account. Local Auth only. */
export const FAKE_USER_PASSWORD = 'isolation-suite-password';

export type EnrolmentStatus = 'active' | 'inactive';

export interface SubscriberSpec {
  email: string;
  displayName: string;
  sourceSpreadsheetId: string;
  status: EnrolmentStatus;
}

/** The fixed fake users every isolation test file shares. */
export const SUBSCRIBER_SPECS = {
  x: {
    email: 'x@test.local',
    displayName: 'Subscriber X',
    sourceSpreadsheetId: 'isolation-sheet-x',
    status: 'active',
  },
  y: {
    email: 'y@test.local',
    displayName: 'Subscriber Y',
    sourceSpreadsheetId: 'isolation-sheet-y',
    status: 'active',
  },
  inactive: {
    email: 'inactive@test.local',
    displayName: 'Inactive Subscriber',
    sourceSpreadsheetId: 'isolation-sheet-inactive',
    status: 'inactive',
  },
} as const satisfies Record<string, SubscriberSpec>;

/** Signed in, but with no Subscriber row: a Sign-In Account only. */
export const OUTSIDER_EMAIL = 'outsider@test.local';

export function createServiceClient(env: LocalSupabaseEnv): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Finds or creates a confirmed Sign-In Account with the fake password. Safe to
 * re-run against the same stack: an existing account is reused, never deleted.
 */
export async function ensureSignInAccount(
  service: SupabaseClient,
  email: string
): Promise<string> {
  const existing = await findSignInAccountId(service, email);
  if (existing) {
    const { error } = await service.auth.admin.updateUserById(existing, {
      password: FAKE_USER_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`Could not reset ${email}: ${error.message}`);
    return existing;
  }
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: FAKE_USER_PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not create ${email}: ${error.message}`);
  return data.user.id;
}

async function findSignInAccountId(
  service: SupabaseClient,
  email: string
): Promise<string | undefined> {
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw new Error(`Could not list auth users: ${error.message}`);
    const match = data.users.find((user) => user.email === email);
    if (match) return match.id;
    if (data.users.length < perPage) return undefined;
  }
}

/**
 * Finds or creates the Subscriber row for a Sign-In Account and converges it
 * to the spec. Subscribers are never deleted: later tables reference them with
 * `on delete restrict`.
 */
export async function ensureSubscriber(
  service: SupabaseClient,
  authUserId: string,
  spec: SubscriberSpec
): Promise<string> {
  const { data, error } = await service
    .from('subscribers')
    .upsert(
      {
        auth_user_id: authUserId,
        display_name: spec.displayName,
        source_spreadsheet_id: spec.sourceSpreadsheetId,
        coach_template: 'coach-partner',
        status: spec.status,
      },
      { onConflict: 'auth_user_id' }
    )
    .select('id')
    .single();
  if (error) {
    throw new Error(
      `Could not provision Subscriber ${spec.email}: ${error.message}`
    );
  }
  return data.id;
}

export async function assertHasNoSubscriber(
  service: SupabaseClient,
  authUserId: string,
  email: string
): Promise<void> {
  const { data, error } = await service
    .from('subscribers')
    .select('id')
    .eq('auth_user_id', authUserId);
  if (error) throw new Error(`Could not check ${email}: ${error.message}`);
  if (data.length > 0) {
    throw new Error(
      `${email} must have no Subscriber row, but has one. Run \`npx supabase db reset\`.`
    );
  }
}

/** Signs in against local Auth and returns the user's access token. */
export async function signIn(
  env: LocalSupabaseEnv,
  email: string
): Promise<string> {
  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: FAKE_USER_PASSWORD,
  });
  if (error) throw new Error(`Could not sign in ${email}: ${error.message}`);
  return data.session.access_token;
}

/** A unique value for rows a test creates and leaves behind. */
export function throwawayValue(label: string): string {
  return `isolation-${label}-${randomUUID()}`;
}

/** A new Sign-In Account with a unique email and no Subscriber row. */
export async function createThrowawaySignInAccount(
  service: SupabaseClient
): Promise<string> {
  return ensureSignInAccount(service, `${throwawayValue('user')}@test.local`);
}

/**
 * A new Sign-In Account plus an active Subscriber with a unique Source
 * Spreadsheet ID. The rows stay behind; nothing else depends on them.
 */
export async function createThrowawaySubscriber(
  service: SupabaseClient
): Promise<{ authUserId: string; subscriberId: string }> {
  const authUserId = await createThrowawaySignInAccount(service);
  const subscriberId = await ensureSubscriber(service, authUserId, {
    email: `throwaway Subscriber for ${authUserId}`,
    displayName: 'Throwaway Subscriber',
    sourceSpreadsheetId: throwawayValue('sheet'),
    status: 'active',
  });
  return { authUserId, subscriberId };
}
