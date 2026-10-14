import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { inject } from 'vitest';

import { assertLocalSupabaseUrl } from './env';
import type { SubscriberKey } from './global-setup';
import { createServiceClient } from './provision';

export {
  createThrowawaySignInAccount,
  createThrowawaySubscriber,
  subscriberRow,
  throwawayValue,
} from './provision';

export interface SubscriberFixture {
  email: string;
  authUserId: string;
  subscriberId: string;
  /** PostgREST client carrying this Subscriber's access token. */
  client: SupabaseClient;
}

export interface SignInAccountFixture {
  email: string;
  authUserId: string;
  /** PostgREST client carrying this Sign-In Account's access token. */
  client: SupabaseClient;
}

export interface IsolationFixtures {
  /** Active Subscriber x@test.local. */
  x: SubscriberFixture;
  /** Active Subscriber y@test.local. */
  y: SubscriberFixture;
  /** Inactive Subscriber inactive@test.local: Enrolment ended. */
  inactive: SubscriberFixture;
  /** outsider@test.local: signed in, no Subscriber row. */
  outsider: SignInAccountFixture;
  /** Not signed in at all: the anon key only. */
  anon: SupabaseClient;
  /** Bypasses RLS. Use it to arrange fixtures and to check what really changed. */
  service: SupabaseClient;
}

/**
 * Clients for the shared fake users that the global setup provisioned and
 * signed in. Call it at the top of a test file.
 */
export function getFixtures(): IsolationFixtures {
  const { env, subscribers, outsider } = inject('isolation');
  assertLocalSupabaseUrl(env.url);

  const clientFor = (accessToken: string) =>
    createClient(env.url, env.anonKey, {
      accessToken: async () => accessToken,
    });
  const subscriber = (key: SubscriberKey): SubscriberFixture => {
    const { accessToken, ...rest } = subscribers[key];
    return { ...rest, client: clientFor(accessToken) };
  };

  return {
    x: subscriber('x'),
    y: subscriber('y'),
    inactive: subscriber('inactive'),
    outsider: {
      email: outsider.email,
      authUserId: outsider.authUserId,
      client: clientFor(outsider.accessToken),
    },
    anon: createClient(env.url, env.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    service: createServiceClient(env),
  };
}
