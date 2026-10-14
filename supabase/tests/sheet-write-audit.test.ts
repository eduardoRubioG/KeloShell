import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  createThrowawaySubscriber,
  getFixtures,
  throwawayValue,
} from './support/fixtures';
import { runSql } from './support/sql';

const { x, y, inactive, outsider, anon, service } = getFixtures();

type Row = Record<string, unknown>;

/** A valid audit payload, unique per call so a test finds exactly its rows. */
function auditRow(subscriberId: string, overrides: Row = {}) {
  return {
    subscriber_id: subscriberId,
    spreadsheet_id: throwawayValue('sheet'),
    tab: 'Tracking',
    range: 'A1:B2',
    operation: 'write',
    ...overrides,
  };
}

/** The real rows for a spreadsheet ID, read as the service role. */
async function rowsFor(spreadsheetId: string): Promise<Row[]> {
  const { data, error } = await service
    .from('sheet_write_audit')
    .select('*')
    .eq('spreadsheet_id', spreadsheetId)
    .order('id');
  if (error) throw error;
  return data as Row[];
}

/** Arranges one audit row through the service role and returns it. */
async function seedRow(subscriberId: string): Promise<Row> {
  const row = auditRow(subscriberId);
  const { error } = await service.from('sheet_write_audit').insert(row);
  if (error) throw error;
  const rows = await rowsFor(row.spreadsheet_id);
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** Proves X's insert path works, so a refusal beside it isn't a broken payload. */
async function expectOwnInsertWorks(): Promise<void> {
  const row = auditRow(x.subscriberId);
  const { error } = await x.client.from('sheet_write_audit').insert(row);
  expect(error).toBeNull();
  expect(await rowsFor(row.spreadsheet_id)).toHaveLength(1);
}

describe('sheet_write_audit: inserts', () => {
  it('lets X log a write for themselves, stored as sent', async () => {
    const row = auditRow(x.subscriberId, { operation: 'clear' });
    const before = Date.now();
    const { data, error } = await x.client
      .from('sheet_write_audit')
      .insert(row);
    expect(error).toBeNull();
    expect(data).toBeNull();

    const [stored] = await rowsFor(row.spreadsheet_id);
    expect(stored).toMatchObject(row);
    expect(typeof stored.id).toBe('number');
    expect(
      Math.abs(Date.parse(stored.written_at as string) - before)
    ).toBeLessThan(60_000);
  });

  it('defaults subscriber_id to the caller', async () => {
    const { subscriber_id: _omit, ...row } = auditRow(x.subscriberId);
    const { error } = await x.client.from('sheet_write_audit').insert(row);
    expect(error).toBeNull();
    const [stored] = await rowsFor(row.spreadsheet_id);
    expect(stored.subscriber_id).toBe(x.subscriberId);
  });

  it("logs a write to Y's spreadsheet when X sent it, as sent", async () => {
    const { data: yRow, error: yError } = await service
      .from('subscribers')
      .select('source_spreadsheet_id')
      .eq('id', y.subscriberId)
      .single();
    expect(yError).toBeNull();
    const yTab = throwawayValue('tab');
    const row = auditRow(x.subscriberId, {
      spreadsheet_id: yRow?.source_spreadsheet_id,
      tab: yTab,
    });
    const { error } = await x.client.from('sheet_write_audit').insert(row);
    expect(error).toBeNull();

    const { data } = await service
      .from('sheet_write_audit')
      .select('*')
      .eq('tab', yTab);
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      subscriber_id: x.subscriberId,
      spreadsheet_id: row.spreadsheet_id,
    });
  });

  it("refuses a row carrying Y's subscriber_id", async () => {
    await expectOwnInsertWorks();
    const row = auditRow(y.subscriberId);
    const { error } = await x.client.from('sheet_write_audit').insert(row);
    expect(error).not.toBeNull();
    expect(await rowsFor(row.spreadsheet_id)).toEqual([]);
  });

  it('refuses a client-supplied written_at', async () => {
    await expectOwnInsertWorks();
    const row = auditRow(x.subscriberId, {
      written_at: '2020-01-01T00:00:00Z',
    });
    const { error } = await x.client.from('sheet_write_audit').insert(row);
    expect(error).not.toBeNull();
    expect(await rowsFor(row.spreadsheet_id)).toEqual([]);
  });

  it('refuses a client-supplied id', async () => {
    await expectOwnInsertWorks();
    const row = auditRow(x.subscriberId, { id: 999_999_999 });
    const { error } = await x.client.from('sheet_write_audit').insert(row);
    expect(error).not.toBeNull();
    expect(await rowsFor(row.spreadsheet_id)).toEqual([]);
  });

  it('refuses an unknown operation, while a valid one works', async () => {
    await expectOwnInsertWorks();
    const row = auditRow(x.subscriberId, { operation: 'append' });
    const { error } = await x.client.from('sheet_write_audit').insert(row);
    expect(error).not.toBeNull();
    expect(await rowsFor(row.spreadsheet_id)).toEqual([]);
  });

  it('refuses a representation return, because there is no select policy', async () => {
    const row = auditRow(x.subscriberId);
    const { error } = await x.client
      .from('sheet_write_audit')
      .insert(row)
      .select();
    expect(error).not.toBeNull();
    expect(await rowsFor(row.spreadsheet_id)).toEqual([]);
  });

  it('refuses the Inactive Subscriber, the outsider and anon', async () => {
    await expectOwnInsertWorks();
    const attempts: [string, SupabaseClient, string][] = [
      ['inactive', inactive.client, inactive.subscriberId],
      ['outsider', outsider.client, x.subscriberId],
      ['anon', anon, x.subscriberId],
    ];
    for (const [name, client, subscriberId] of attempts) {
      const row = auditRow(subscriberId, { tab: name });
      const { error } = await client.from('sheet_write_audit').insert(row);
      expect(error, name).not.toBeNull();
      expect(await rowsFor(row.spreadsheet_id), name).toEqual([]);
    }
    // Without a subscriber_id they resolve to null and fail not null.
    for (const client of [inactive.client, outsider.client]) {
      const { subscriber_id: _omit, ...row } = auditRow(x.subscriberId);
      const { error } = await client.from('sheet_write_audit').insert(row);
      expect(error).not.toBeNull();
      expect(await rowsFor(row.spreadsheet_id)).toEqual([]);
    }
  });
});

describe('sheet_write_audit: reads', () => {
  it('shows X nothing, not even their own rows', async () => {
    const own = await seedRow(x.subscriberId);
    const { data: control } = await service
      .from('sheet_write_audit')
      .select('id')
      .eq('id', own.id as number);
    expect(control).toHaveLength(1);

    for (const [name, client] of [
      ['x', x.client],
      ['y', y.client],
      ['inactive', inactive.client],
      ['outsider', outsider.client],
    ] as const) {
      const { data, error } = await client
        .from('sheet_write_audit')
        .select('*');
      // No select grant: refused outright. Either way, no row comes back.
      expect(error, name).not.toBeNull();
      expect(data ?? [], name).toEqual([]);
    }
  });

  it('refuses anon outright, and lets the service role read', async () => {
    const own = await seedRow(y.subscriberId);
    const { error } = await anon.from('sheet_write_audit').select('*');
    expect(error).not.toBeNull();
    expect(await rowsFor(own.spreadsheet_id as string)).toEqual([own]);
  });
});

describe('sheet_write_audit: append-only', () => {
  it('refuses X an update and a delete over SQL, leaving the row unchanged', async () => {
    const row = await seedRow(x.subscriberId);
    const asX = { role: 'authenticated', sub: x.authUserId } as const;

    // Positive control: the same session can insert a row of its own, so the
    // refusals below are about update and delete, not a broken session.
    const own = runSql(
      `insert into public.sheet_write_audit (spreadsheet_id, tab, range, operation)
       values ('${throwawayValue('sql')}', 'Tracking', 'A1', 'write');`,
      asX
    );
    expect(own.stderr).toBe('');
    expect(own.ok).toBe(true);

    for (const sql of [
      `update public.sheet_write_audit set tab = 'changed' where id = ${row.id};`,
      `delete from public.sheet_write_audit where id = ${row.id};`,
    ]) {
      const result = runSql(sql, asX);
      expect(result.ok, sql).toBe(false);
      expect(result.sqlstate, sql).toBe('42501');
      expect(result.stderr, sql).toContain('permission denied');
    }
    expect(await rowsFor(row.spreadsheet_id as string)).toEqual([row]);
  });

  it('refuses the service role an update and a delete, leaving the row unchanged', async () => {
    const row = await seedRow(x.subscriberId);

    const update = await service
      .from('sheet_write_audit')
      .update({ tab: 'changed' })
      .eq('id', row.id as number);
    expect(update.error?.message).toContain('append-only');
    expect(update.error?.code).toBe('42501');
    const del = await service
      .from('sheet_write_audit')
      .delete()
      .eq('id', row.id as number);
    expect(del.error?.message).toContain('append-only');
    expect(del.error?.code).toBe('42501');
    expect(await rowsFor(row.spreadsheet_id as string)).toEqual([row]);
  });

  it('refuses the service role a truncate, leaving the rows unchanged', async () => {
    const row = await seedRow(x.subscriberId);

    // Positive control: the same session and role can read the table.
    const control = runSql('select count(*) from public.sheet_write_audit;', {
      role: 'service_role',
    });
    expect(control.ok).toBe(true);

    const result = runSql('truncate public.sheet_write_audit;', {
      role: 'service_role',
    });
    expect(result.ok).toBe(false);
    expect(result.sqlstate).toBe('42501');
    expect(await rowsFor(row.spreadsheet_id as string)).toEqual([row]);
  });

  it('refuses the service role a trigger of its own on the table', async () => {
    // Positive control: the same role can insert a row in the same session.
    const control = runSql(
      `insert into public.sheet_write_audit
         (subscriber_id, spreadsheet_id, tab, range, operation)
       values ('${x.subscriberId}', '${throwawayValue('sql')}', 't', 'A1', 'write');`,
      { role: 'service_role' }
    );
    expect(control.stderr).toBe('');
    expect(control.ok).toBe(true);

    const result = runSql(
      `create function pg_temp.noop() returns trigger language plpgsql as $$ begin return new; end $$;
       create trigger rogue before insert on public.sheet_write_audit
         for each row execute function pg_temp.noop();`,
      { role: 'service_role' }
    );
    expect(result.ok).toBe(false);
    expect(result.sqlstate).toBe('42501');
  });

  it('stores the database clock even when the service role sends a written_at', async () => {
    const row = auditRow(x.subscriberId, {
      written_at: '2001-01-01T00:00:00Z',
    });
    const before = Date.now();
    const { error } = await service.from('sheet_write_audit').insert(row);
    expect(error).toBeNull();
    const [stored] = await rowsFor(row.spreadsheet_id);
    expect(
      Math.abs(Date.parse(stored.written_at as string) - before)
    ).toBeLessThan(60_000);
  });
});

describe('sheet_write_audit: Subscriber deletion', () => {
  it('refuses the whole delete and keeps the Subscriber and their other rows', async () => {
    const { subscriberId } = await createThrowawaySubscriber(service);
    const audit = await seedRow(subscriberId);
    const steps = await service.from('daily_steps').insert({
      subscriber_id: subscriberId,
      local_date: '2026-01-01',
      steps: 100,
    });
    expect(steps.error).toBeNull();

    // Control: a Subscriber with no audit rows can be deleted.
    const { subscriberId: freeId } = await createThrowawaySubscriber(service);
    const free = await service.from('subscribers').delete().eq('id', freeId);
    expect(free.error).toBeNull();

    const { error } = await service
      .from('subscribers')
      .delete()
      .eq('id', subscriberId);
    // The foreign key itself refuses it. (The delete trigger would also
    // refuse a cascade, so the message tells the two guards apart.)
    expect(error?.code).toBe('23503');
    expect(error?.message).toContain('foreign key');

    const sub = await service
      .from('subscribers')
      .select('id')
      .eq('id', subscriberId);
    expect(sub.data).toHaveLength(1);
    const kept = await service
      .from('daily_steps')
      .select('*')
      .eq('subscriber_id', subscriberId);
    expect(kept.data).toHaveLength(1);
    const prefs = await service
      .from('reminder_settings')
      .select('kind')
      .eq('subscriber_id', subscriberId);
    expect(prefs.data).toHaveLength(5);
    expect(await rowsFor(audit.spreadsheet_id as string)).toEqual([audit]);
  });
});
