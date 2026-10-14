import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  createThrowawaySignInAccount,
  createThrowawaySubscriber,
  getFixtures,
  throwawayValue,
} from './support/fixtures';

const { x, y, inactive, outsider, anon, service } = getFixtures();

/** Every caller that isn't the service role. */
const callers: [string, SupabaseClient][] = [
  ['Subscriber X', x.client],
  ['Subscriber Y', y.client],
  ['the Inactive Subscriber', inactive.client],
  ['the outsider (no Subscriber row)', outsider.client],
  ['an anonymous caller', anon],
];

/** Every Subscriber row a caller might try to change. */
const targets: [string, string][] = [
  ['X', x.subscriberId],
  ['Y', y.subscriberId],
  ['the Inactive Subscriber', inactive.subscriberId],
];

async function rowsVisibleTo(
  client: SupabaseClient,
  filter?: { id: string }
): Promise<{ id: string }[]> {
  let query = client.from('subscribers').select('*');
  if (filter) query = query.eq('id', filter.id);
  const { data } = await query;
  // A refused read (an error, no data) also means nothing is visible.
  return data ?? [];
}

/** The row as it really is, read past RLS. */
async function actualRow(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await service
    .from('subscribers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

describe('reading subscribers', () => {
  it('lets Subscriber X read exactly their own row', async () => {
    const rows = await rowsVisibleTo(x.client);
    expect(rows.map((row) => row.id)).toEqual([x.subscriberId]);
  });

  it('lets Subscriber Y read exactly their own row', async () => {
    const rows = await rowsVisibleTo(y.client);
    expect(rows.map((row) => row.id)).toEqual([y.subscriberId]);
  });

  it("hides Y's row from X even when X asks for it by id", async () => {
    expect(await rowsVisibleTo(x.client, { id: y.subscriberId })).toEqual([]);
    expect(await rowsVisibleTo(y.client, { id: x.subscriberId })).toEqual([]);
  });

  it('shows the Inactive Subscriber zero rows, including their own', async () => {
    expect(await rowsVisibleTo(inactive.client)).toEqual([]);
    expect(
      await rowsVisibleTo(inactive.client, { id: inactive.subscriberId })
    ).toEqual([]);
  });

  it('shows a signed-in user with no Subscriber row zero rows', async () => {
    expect(await rowsVisibleTo(outsider.client)).toEqual([]);
  });

  it('shows an anonymous caller zero rows', async () => {
    expect(await rowsVisibleTo(anon)).toEqual([]);
  });
});

describe.each(callers)('writes by %s', (_name, client) => {
  it('cannot insert a Subscriber row', async () => {
    const sourceSpreadsheetId = throwawayValue('sheet');
    await client.from('subscribers').insert({
      auth_user_id: outsider.authUserId,
      display_name: 'Self-enrolled',
      source_spreadsheet_id: sourceSpreadsheetId,
      coach_template: 'coach-partner',
      status: 'active',
    });

    const { data, error } = await service
      .from('subscribers')
      .select('id')
      .eq('source_spreadsheet_id', sourceSpreadsheetId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it.each(targets)("cannot update %s's row", async (_target, id) => {
    const before = await actualRow(id);
    expect(before).not.toBeNull();

    const changes = [
      { source_spreadsheet_id: throwawayValue('hijacked-sheet') },
      { status: 'active' },
      { status: 'inactive' },
      { display_name: 'Hijacked' },
      { auth_user_id: outsider.authUserId },
    ];
    for (const change of changes) {
      await client.from('subscribers').update(change).eq('id', id);
    }

    expect(await actualRow(id)).toEqual(before);
  });

  it.each(targets)("cannot delete %s's row", async (_target, id) => {
    await client.from('subscribers').delete().eq('id', id);
    expect(await actualRow(id)).not.toBeNull();
  });
});

describe('what the database refuses, even from the service role', () => {
  it('refuses a second Subscriber with an existing Source Spreadsheet ID', async () => {
    const authUserId = await createThrowawaySignInAccount(service);
    const existing = await actualRow(x.subscriberId);

    const { error } = await service.from('subscribers').insert({
      auth_user_id: authUserId,
      display_name: 'Duplicate sheet',
      source_spreadsheet_id: existing?.source_spreadsheet_id,
      coach_template: 'coach-partner',
      status: 'active',
    });
    expect(error).not.toBeNull();

    const { data } = await service
      .from('subscribers')
      .select('id')
      .eq('source_spreadsheet_id', existing?.source_spreadsheet_id);
    expect(data?.map((row) => row.id)).toEqual([x.subscriberId]);

    // The throwaway Sign-In Account has no Subscriber, so it can go.
    await service.auth.admin.deleteUser(authUserId);
  });

  it('refuses a second Subscriber for the same Sign-In Account', async () => {
    const { error } = await service.from('subscribers').insert({
      auth_user_id: x.authUserId,
      display_name: 'Second X',
      source_spreadsheet_id: throwawayValue('sheet'),
      coach_template: 'coach-partner',
      status: 'active',
    });
    expect(error).not.toBeNull();
    expect(await rowsVisibleTo(x.client)).toHaveLength(1);
  });

  it('refuses to delete a Sign-In Account that has a Subscriber row', async () => {
    const { authUserId, subscriberId } =
      await createThrowawaySubscriber(service);

    const { error } = await service.auth.admin.deleteUser(authUserId);
    expect(error).not.toBeNull();

    const { data } = await service.auth.admin.getUserById(authUserId);
    expect(data.user?.id).toBe(authUserId);
    expect(await actualRow(subscriberId)).not.toBeNull();
  });

  it.each([
    ['an unknown Enrolment status', { status: 'lapsed' }],
    ['an unknown coach template', { coach_template: 'other-coach' }],
  ])('refuses %s', async (_name, change) => {
    const { subscriberId } = await createThrowawaySubscriber(service);
    const before = await actualRow(subscriberId);

    const { error } = await service
      .from('subscribers')
      .update(change)
      .eq('id', subscriberId);
    expect(error).not.toBeNull();
    expect(await actualRow(subscriberId)).toEqual(before);
  });
});

describe('updated_at', () => {
  it('moves forward when the service role changes a row', async () => {
    const { subscriberId } = await createThrowawaySubscriber(service);
    const before = await actualRow(subscriberId);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const { error } = await service
      .from('subscribers')
      .update({ display_name: 'Renamed' })
      .eq('id', subscriberId);
    expect(error).toBeNull();

    const after = await actualRow(subscriberId);
    expect(Date.parse(String(after?.updated_at))).toBeGreaterThan(
      Date.parse(String(before?.updated_at))
    );
    expect(after?.created_at).toBe(before?.created_at);
  });
});
