import type { TestProject } from 'vitest/node';

import { resolveLocalSupabaseEnv, type LocalSupabaseEnv } from './env';
import {
  OUTSIDER_EMAIL,
  SUBSCRIBER_SPECS,
  assertHasNoSubscriber,
  createServiceClient,
  ensureSignInAccount,
  ensureSubscriber,
  signIn,
} from './provision';

export type SubscriberKey = keyof typeof SUBSCRIBER_SPECS;

export interface ProvisionedSubscriber {
  email: string;
  authUserId: string;
  subscriberId: string;
  accessToken: string;
}

export interface ProvisionedSignInAccount {
  email: string;
  authUserId: string;
  accessToken: string;
}

export interface IsolationContext {
  env: LocalSupabaseEnv;
  subscribers: Record<SubscriberKey, ProvisionedSubscriber>;
  outsider: ProvisionedSignInAccount;
}

declare module 'vitest' {
  export interface ProvidedContext {
    isolation: IsolationContext;
  }
}

/**
 * Runs once per `npm run test:isolation`: refuses non-local URLs, then finds or
 * creates the fake users and signs each in once, so every test file shares the
 * same tokens without hitting local Auth's sign-in rate limit.
 */
export default async function setup(project: TestProject): Promise<void> {
  const env = resolveLocalSupabaseEnv();
  const service = createServiceClient(env);

  const subscribers = {} as Record<SubscriberKey, ProvisionedSubscriber>;
  for (const key of Object.keys(SUBSCRIBER_SPECS) as SubscriberKey[]) {
    const spec = SUBSCRIBER_SPECS[key];
    const authUserId = await ensureSignInAccount(service, spec.email);
    const subscriberId = await ensureSubscriber(service, authUserId, spec);
    const accessToken = await signIn(env, spec.email);
    subscribers[key] = {
      email: spec.email,
      authUserId,
      subscriberId,
      accessToken,
    };
  }

  const outsiderId = await ensureSignInAccount(service, OUTSIDER_EMAIL);
  await assertHasNoSubscriber(service, outsiderId, OUTSIDER_EMAIL);
  const outsider = {
    email: OUTSIDER_EMAIL,
    authUserId: outsiderId,
    accessToken: await signIn(env, OUTSIDER_EMAIL),
  };

  project.provide('isolation', { env, subscribers, outsider });
}
