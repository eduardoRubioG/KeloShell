import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import { getFixtures } from './support/fixtures';

const { x, y, inactive, outsider, anon, service } = getFixtures();

type Row = Record<string, unknown>;

/** What differs between the two Subscriber-keyed App-Owned Data tables. */
interface TableCase {
  table: 'daily_steps' | 'habit_entries';
  /** Columns that, with subscriber_id, identify a row. */
  keyColumns: string[];
  /** A valid row for a date, without subscriber_id. */
  row: (localDate: string) => Row;
  /** A fresh change, valid for an existing row, that the tests can see. */
  change: () => Row;
  /** The value that replaces a day's first value in the upsert test. */
  replacement: (localDate: string) => Row;
  /** Asserts the upsert left a single row holding the replacement. */
  expectReplaced: (rows: Row[]) => void;
}

const tables: TableCase[] = [
  {
    table: 'daily_steps',
    keyColumns: ['local_date'],
    row: (localDate) => ({ local_date: localDate, steps: 4000 }),
    change: () => ({ steps: 9000 }),
    replacement: (localDate) => ({ local_date: localDate, steps: 9000 }),
    expectReplaced: (rows) => expect(rows.map((r) => r.steps)).toEqual([9000]),
  },
  {
    table: 'habit_entries',
    keyColumns: ['habit', 'local_date'],
    row: (localDate) => ({ habit: 'creatine', local_date: localDate }),
    // Moving an entry to another day is the Edit a client really makes.
    change: () => ({ local_date: uniqueDate() }),
    // A habit has no value to replace: a repeat for the same day is a no-op.
    replacement: (localDate) => ({ habit: 'creatine', local_date: localDate }),
    expectReplaced: (rows) => expect(rows).toHaveLength(1),
  },
];

const stepsCase = tables.find((t) => t.table === 'daily_steps') as TableCase;

const usedDates = new Set<string>();

/**
 * A date no other run has used, so the suite re-runs without `db reset`.
 * Random days across 1000-9999 keep collisions vanishingly unlikely.
 */
function uniqueDate(): string {
  for (;;) {
    const year = 1000 + Math.floor(Math.random() * 9000);
    const month = 1 + Math.floor(Math.random() * 12);
    const day = 1 + Math.floor(Math.random() * 28);
    const date = [year, month, day]
      .map((part, i) => String(part).padStart(i === 0 ? 4 : 2, '0'))
      .join('-');
    if (!usedDates.has(date)) {
      usedDates.add(date);
      return date;
    }
  }
}

/** Removes every row this run created, whoever it belongs to. */
afterAll(async () => {
  const dates = [...usedDates];
  for (const { table } of tables) {
    const { error } = await service
      .from(table)
      .delete()
      .in('local_date', dates);
    if (error) throw error;
  }
});

/** Every row on the table for these dates, as it really is, read past RLS. */
async function actualRows(table: string, dates: string[]): Promise<Row[]> {
  const { data, error } = await service
    .from(table)
    .select('*')
    .in('local_date', dates)
    .order('subscriber_id')
    .order('local_date');
  if (error) throw error;
  return data;
}

/** Arranges a row for a Subscriber through the service role. */
async function seed(
  { table, row }: TableCase,
  subscriberId: string,
  date: string
): Promise<Row> {
  const { data, error } = await service
    .from(table)
    .insert({ ...row(date), subscriber_id: subscriberId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** A signed-in read must succeed, so an empty result is RLS, not an error. */
async function readAll(
  client: SupabaseClient,
  table: string,
  dates: string[]
): Promise<Row[]> {
  const { data, error } = await client
    .from(table)
    .select('*')
    .in('local_date', dates);
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  return data ?? [];
}

describe.each(tables)('$table', (tc) => {
  const { table, keyColumns, row, change, replacement, expectReplaced } = tc;
  const keyOf = (r: Row) => keyColumns.map((column) => r[column]);

  describe('a Subscriber managing their own rows', () => {
    it('inserts without sending subscriber_id, and the row is theirs', async () => {
      const date = uniqueDate();
      const { error } = await x.client.from(table).insert(row(date));
      expect(error).toBeNull();

      const rows = await actualRows(table, [date]);
      expect(rows).toHaveLength(1);
      expect(rows[0].subscriber_id).toBe(x.subscriberId);
    });

    it('reads their own rows', async () => {
      const date = uniqueDate();
      await seed(tc, x.subscriberId, date);
      const rows = await readAll(x.client, table, [date]);
      expect(rows.map((r) => r.subscriber_id)).toEqual([x.subscriberId]);
      expect(rows.map(keyOf)).toEqual([keyOf(row(date))]);
    });

    it('updates their own row', async () => {
      const date = uniqueDate();
      await seed(tc, x.subscriberId, date);

      const before = await actualRows(table, [date]);
      const changes = change();
      const { data, error } = await x.client
        .from(table)
        .update(changes)
        .eq('subscriber_id', x.subscriberId)
        .eq('local_date', date)
        .select();
      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const after = await actualRows(table, [
        date,
        ...[changes.local_date].filter((d): d is string => !!d),
      ]);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject(changes);
      expect(after).not.toEqual(before);
    });

    it('deletes their own row (a Clear is a hard delete)', async () => {
      const date = uniqueDate();
      await seed(tc, x.subscriberId, date);

      const { data, error } = await x.client
        .from(table)
        .delete()
        .eq('local_date', date)
        .select();
      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      // Gone from the table itself, not merely hidden from X.
      expect(await actualRows(table, [date])).toEqual([]);
    });

    it("replaces a day's value with a second one (upsert, subscriber_id omitted)", async () => {
      const date = uniqueDate();
      const upsert = (values: Row) =>
        x.client
          .from(table)
          .upsert(values, {
            onConflict: ['subscriber_id', ...keyColumns].join(','),
          })
          .select();

      const first = await upsert(row(date));
      expect(first.error).toBeNull();
      expect(first.data).toHaveLength(1);

      const second = await upsert(replacement(date));
      expect(second.error).toBeNull();
      expect(second.data).toHaveLength(1);

      const rows = await actualRows(table, [date]);
      expect(rows).toHaveLength(1);
      expect(rows[0].subscriber_id).toBe(x.subscriberId);
      expectReplaced(rows);
    });
  });

  describe('isolation between Subscribers', () => {
    it("shows X none of Y's rows, even when asked by date", async () => {
      const date = uniqueDate();
      await seed(tc, y.subscriberId, date);

      expect(await readAll(x.client, table, [date])).toEqual([]);
      expect(await readAll(y.client, table, [date])).toHaveLength(1);
    });

    it("refuses to insert a row with Y's subscriber_id", async () => {
      const refusedDate = uniqueDate();
      const controlDate = uniqueDate();

      // Control: the same payload shape is accepted for X's own id.
      const control = await x.client
        .from(table)
        .insert({ ...row(controlDate), subscriber_id: x.subscriberId });
      expect(control.error).toBeNull();

      const { error } = await x.client
        .from(table)
        .insert({ ...row(refusedDate), subscriber_id: y.subscriberId });
      expect(error).not.toBeNull();
      expect(await actualRows(table, [refusedDate])).toEqual([]);
    });

    it("refuses to move X's own row to Y's subscriber_id", async () => {
      const date = uniqueDate();
      await seed(tc, x.subscriberId, date);
      const before = await actualRows(table, [date]);

      const { error } = await x.client
        .from(table)
        .update({ subscriber_id: y.subscriberId })
        .eq('local_date', date);
      expect(error).not.toBeNull();
      expect(await actualRows(table, [date])).toEqual(before);
    });

    it("cannot update or delete Y's rows", async () => {
      const date = uniqueDate();
      await seed(tc, y.subscriberId, date);
      const before = await actualRows(table, [date]);

      // Control: Y can change the very same row with the same payload.
      const controlChange = change();
      const control = await y.client
        .from(table)
        .update(controlChange)
        .eq('local_date', date)
        .select();
      expect(control.error).toBeNull();
      expect(control.data).toHaveLength(1);
      const datesInPlay = [
        date,
        ...[controlChange.local_date].filter((d): d is string => !!d),
      ];
      const afterControl = await actualRows(table, datesInPlay);
      expect(afterControl).not.toEqual(before);

      const update = await x.client
        .from(table)
        .update(change())
        .eq('subscriber_id', y.subscriberId)
        .eq('local_date', datesInPlay[datesInPlay.length - 1])
        .select();
      expect(update.data ?? []).toEqual([]);
      const del = await x.client
        .from(table)
        .delete()
        .eq('subscriber_id', y.subscriberId)
        .eq('local_date', datesInPlay[datesInPlay.length - 1])
        .select();
      expect(del.data ?? []).toEqual([]);

      expect(await actualRows(table, datesInPlay)).toEqual(afterControl);
    });
  });

  describe.each([
    ['the Inactive Subscriber', inactive.client],
    ['the outsider (no Subscriber row)', outsider.client],
  ] as [string, SupabaseClient][])('%s', (_name, client) => {
    it('reads nothing, without an error', async () => {
      const date = uniqueDate();
      await seed(tc, x.subscriberId, date);
      // The caller's own row, if they have a Subscriber, is the meaningful one:
      // an Inactive Subscriber must not see it either.
      await seed(tc, inactive.subscriberId, date);
      expect(await readAll(client, table, [date])).toEqual([]);
    });

    it('cannot insert, with or without a subscriber_id', async () => {
      const omitted = uniqueDate();
      const own = uniqueDate();
      const forX = uniqueDate();

      // Control: X is accepted with each payload shape.
      const controls = await Promise.all([
        x.client.from(table).insert(row(uniqueDate())),
        x.client
          .from(table)
          .insert({ ...row(uniqueDate()), subscriber_id: x.subscriberId }),
      ]);
      for (const { error } of controls) expect(error).toBeNull();

      const results = await Promise.all([
        client.from(table).insert(row(omitted)),
        client
          .from(table)
          .insert({ ...row(own), subscriber_id: inactive.subscriberId }),
        client
          .from(table)
          .insert({ ...row(forX), subscriber_id: x.subscriberId }),
      ]);
      for (const { error } of results) expect(error).not.toBeNull();
      expect(await actualRows(table, [omitted, own, forX])).toEqual([]);
    });

    it("cannot update or delete anyone's rows", async () => {
      const date = uniqueDate();
      await seed(tc, x.subscriberId, date);
      await seed(tc, inactive.subscriberId, date);
      const before = await actualRows(table, [date]);
      expect(before).toHaveLength(2);

      await client.from(table).update(change()).eq('local_date', date);
      await client.from(table).delete().eq('local_date', date);

      expect(await actualRows(table, [date])).toEqual(before);
    });
  });

  describe('an anonymous caller', () => {
    it('is refused outright', async () => {
      const date = uniqueDate();
      const read = await anon.from(table).select('*');
      expect(read.error).not.toBeNull();
      expect(read.data).toBeNull();

      const insert = await anon.from(table).insert(row(date));
      expect(insert.error).not.toBeNull();
      expect(await actualRows(table, [date])).toEqual([]);
    });
  });
});

describe('what the database refuses', () => {
  it.each([[0], [-1], [-4000]])('refuses steps of %i', async (steps) => {
    const control = uniqueDate();
    const refused = uniqueDate();

    const ok = await x.client
      .from('daily_steps')
      .insert({ local_date: control, steps: 1 });
    expect(ok.error).toBeNull();

    const { error } = await x.client
      .from('daily_steps')
      .insert({ local_date: refused, steps });
    expect(error).not.toBeNull();
    expect(await actualRows('daily_steps', [refused])).toEqual([]);

    // The same refusal holds for an update of an existing row.
    const update = await x.client
      .from('daily_steps')
      .update({ steps })
      .eq('local_date', control);
    expect(update.error).not.toBeNull();
    const [row] = await actualRows('daily_steps', [control]);
    expect(row.steps).toBe(1);
  });

  it('refuses an unknown habit', async () => {
    const control = uniqueDate();
    const refused = uniqueDate();

    const ok = await x.client
      .from('habit_entries')
      .insert({ habit: 'creatine', local_date: control });
    expect(ok.error).toBeNull();

    const { error } = await x.client
      .from('habit_entries')
      .insert({ habit: 'meditation', local_date: refused });
    expect(error).not.toBeNull();
    expect(await actualRows('habit_entries', [refused])).toEqual([]);
  });
});

describe('updated_at on daily_steps', () => {
  it('moves forward when a row is updated', async () => {
    const date = uniqueDate();
    const before = await seed(stepsCase, x.subscriberId, date);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const { error } = await x.client
      .from('daily_steps')
      .update({ steps: 12000 })
      .eq('local_date', date);
    expect(error).toBeNull();

    const [after] = await actualRows('daily_steps', [date]);
    expect(after.steps).toBe(12000);
    expect(Date.parse(String(after.updated_at))).toBeGreaterThan(
      Date.parse(String(before.updated_at))
    );
  });

  it('moves forward when an upsert replaces the value', async () => {
    const date = uniqueDate();
    const before = await seed(stepsCase, x.subscriberId, date);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const { error } = await x.client
      .from('daily_steps')
      .upsert(
        { local_date: date, steps: 7 },
        { onConflict: 'subscriber_id,local_date' }
      );
    expect(error).toBeNull();

    const [after] = await actualRows('daily_steps', [date]);
    expect(after.steps).toBe(7);
    expect(Date.parse(String(after.updated_at))).toBeGreaterThan(
      Date.parse(String(before.updated_at))
    );
  });
});
