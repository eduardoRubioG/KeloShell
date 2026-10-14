import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it } from 'vitest';

import { createThrowawaySubscriber, getFixtures } from './support/fixtures';

const { x, y, inactive, outsider, anon, service } = getFixtures();

type Row = Record<string, unknown>;

const DEFAULT_TIME_ZONE = 'America/New_York';
const DEFAULT_SETTINGS = [
  { kind: 'bodyweight', enabled: true, local_time: '07:00:00' },
  { kind: 'creatine', enabled: true, local_time: '21:00:00' },
  { kind: 'measurement', enabled: true, local_time: '07:00:00' },
  { kind: 'steps', enabled: true, local_time: '22:00:00' },
  { kind: 'steps-yesterday', enabled: true, local_time: '07:30:00' },
];

/** X's and Y's rows are shared by every test file: put the defaults back. */
async function restoreDefaults(subscriberId: string): Promise<void> {
  const prefs = await service
    .from('reminder_preferences')
    .update({ time_zone: DEFAULT_TIME_ZONE })
    .eq('subscriber_id', subscriberId);
  if (prefs.error) throw prefs.error;
  for (const { kind, enabled, local_time } of DEFAULT_SETTINGS) {
    const { error } = await service
      .from('reminder_settings')
      .update({ enabled, local_time })
      .eq('subscriber_id', subscriberId)
      .eq('kind', kind);
    if (error) throw error;
  }
}

afterAll(async () => {
  await restoreDefaults(x.subscriberId);
  await restoreDefaults(y.subscriberId);
});

/** A Subscriber's real rows in both tables, read past RLS. */
async function actualRows(subscriberId: string) {
  const prefs = await service
    .from('reminder_preferences')
    .select('*')
    .eq('subscriber_id', subscriberId);
  if (prefs.error) throw prefs.error;
  const settings = await service
    .from('reminder_settings')
    .select('*')
    .eq('subscriber_id', subscriberId)
    .order('kind');
  if (settings.error) throw settings.error;
  return { preferences: prefs.data as Row[], settings: settings.data as Row[] };
}

/**
 * Both tables for the fixture Subscribers. Other test files create throwaway
 * Subscribers concurrently, so a snapshot of every row would be racy.
 */
async function everyRow() {
  const ids = [x, y, inactive].map((f) => f.subscriberId);
  const prefs = await service
    .from('reminder_preferences')
    .select('*')
    .in('subscriber_id', ids);
  if (prefs.error) throw prefs.error;
  const settings = await service
    .from('reminder_settings')
    .select('*')
    .in('subscriber_id', ids);
  if (settings.error) throw settings.error;
  const byKey = (a: Row, b: Row) =>
    `${a.subscriber_id}${a.kind ?? ''}`.localeCompare(
      `${b.subscriber_id}${b.kind ?? ''}`
    );
  return {
    preferences: (prefs.data as Row[]).sort(byKey),
    settings: (settings.data as Row[]).sort(byKey),
  };
}

/** A signed-in read must succeed, so an empty result is RLS, not an error. */
async function readTable(client: SupabaseClient, table: string) {
  const { data, error } = await client.from(table).select('*');
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  return data ?? [];
}

describe('default rows', () => {
  it('creates the preferences row and all five settings for a new Subscriber', async () => {
    const { subscriberId } = await createThrowawaySubscriber(service);
    const { preferences, settings } = await actualRows(subscriberId);

    expect(preferences).toEqual([
      { subscriber_id: subscriberId, time_zone: DEFAULT_TIME_ZONE },
    ]);
    expect(settings).toEqual(
      DEFAULT_SETTINGS.map((s) => ({ subscriber_id: subscriberId, ...s }))
    );
  });

  it('gives every existing Subscriber the same rows', async () => {
    for (const { subscriberId } of [x, y, inactive]) {
      const { preferences, settings } = await actualRows(subscriberId);
      expect(preferences).toHaveLength(1);
      expect(settings.map((s) => s.kind)).toEqual(
        DEFAULT_SETTINGS.map((s) => s.kind)
      );
    }
  });
});

describe('a Subscriber managing their own reminders', () => {
  it('reads their own time zone and all five settings', async () => {
    const prefs = await readTable(x.client, 'reminder_preferences');
    expect(prefs).toEqual([
      { subscriber_id: x.subscriberId, time_zone: DEFAULT_TIME_ZONE },
    ]);

    const settings = await readTable(x.client, 'reminder_settings');
    expect(settings.every((s) => s.subscriber_id === x.subscriberId)).toBe(
      true
    );
    expect(settings.map((s) => s.kind).sort()).toEqual(
      DEFAULT_SETTINGS.map((s) => s.kind)
    );
  });

  it('updates their own time zone', async () => {
    try {
      const before = await actualRows(x.subscriberId);
      const { data, error } = await x.client
        .from('reminder_preferences')
        .update({ time_zone: 'Europe/London' })
        .eq('subscriber_id', x.subscriberId)
        .select();
      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const after = await actualRows(x.subscriberId);
      expect(after.preferences[0].time_zone).toBe('Europe/London');
      expect(after.preferences).not.toEqual(before.preferences);
    } finally {
      await restoreDefaults(x.subscriberId);
    }
  });

  it('turns creatine off and moves steps to 21:30', async () => {
    try {
      const off = await x.client
        .from('reminder_settings')
        .update({ enabled: false })
        .eq('subscriber_id', x.subscriberId)
        .eq('kind', 'creatine')
        .select();
      expect(off.error).toBeNull();
      expect(off.data).toHaveLength(1);

      const moved = await x.client
        .from('reminder_settings')
        .update({ local_time: '21:30' })
        .eq('subscriber_id', x.subscriberId)
        .eq('kind', 'steps')
        .select();
      expect(moved.error).toBeNull();
      expect(moved.data).toHaveLength(1);

      const { settings } = await actualRows(x.subscriberId);
      const expected = DEFAULT_SETTINGS.map((s) => ({
        subscriber_id: x.subscriberId,
        ...s,
        ...(s.kind === 'creatine' && { enabled: false }),
        ...(s.kind === 'steps' && { local_time: '21:30:00' }),
      }));
      expect(settings).toEqual(expected);
    } finally {
      await restoreDefaults(x.subscriberId);
    }
  });

  it('cannot insert or delete preference or setting rows', async () => {
    // Control: the service role can delete and re-insert the very same
    // payloads, so the refusals below are about who is asking.
    const { subscriberId } = await createThrowawaySubscriber(service);
    const removed = await service
      .from('reminder_settings')
      .delete()
      .eq('subscriber_id', subscriberId)
      .eq('kind', 'creatine')
      .select();
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
    const reinserted = await service.from('reminder_settings').insert({
      subscriber_id: subscriberId,
      kind: 'creatine',
      local_time: '21:00',
    });
    expect(reinserted.error).toBeNull();

    const before = await everyRow();

    const insertSetting = await x.client.from('reminder_settings').insert({
      subscriber_id: x.subscriberId,
      kind: 'creatine',
      local_time: '21:00',
    });
    expect(insertSetting.error).not.toBeNull();

    const insertPref = await x.client
      .from('reminder_preferences')
      .insert({ subscriber_id: x.subscriberId, time_zone: DEFAULT_TIME_ZONE });
    expect(insertPref.error).not.toBeNull();

    const deleteSetting = await x.client
      .from('reminder_settings')
      .delete()
      .eq('subscriber_id', x.subscriberId)
      .eq('kind', 'creatine');
    expect(deleteSetting.error).not.toBeNull();

    const deletePref = await x.client
      .from('reminder_preferences')
      .delete()
      .eq('subscriber_id', x.subscriberId);
    expect(deletePref.error).not.toBeNull();

    expect(await everyRow()).toEqual(before);
  });

  it("cannot change a row's subscriber_id or kind", async () => {
    const before = await actualRows(x.subscriberId);
    const yBefore = await actualRows(y.subscriberId);

    // Control: the same row accepts a legitimate change from X.
    try {
      const control = await x.client
        .from('reminder_settings')
        .update({ enabled: false })
        .eq('subscriber_id', x.subscriberId)
        .eq('kind', 'bodyweight')
        .select();
      expect(control.error).toBeNull();
      expect(control.data).toHaveLength(1);
    } finally {
      await restoreDefaults(x.subscriberId);
    }

    // Free up a kind first, so a retype could only fail because the column
    // is not updatable, not because it collides with another row's key.
    const freed = await service
      .from('reminder_settings')
      .delete()
      .eq('subscriber_id', x.subscriberId)
      .eq('kind', 'steps-yesterday')
      .select();
    expect(freed.error).toBeNull();
    expect(freed.data).toHaveLength(1);
    const afterFreeing = await actualRows(x.subscriberId);
    try {
      const retype = await x.client
        .from('reminder_settings')
        .update({ kind: 'steps-yesterday' })
        .eq('subscriber_id', x.subscriberId)
        .eq('kind', 'bodyweight');
      expect(retype.error).not.toBeNull();
      expect(await actualRows(x.subscriberId)).toEqual(afterFreeing);
    } finally {
      const { error } = await service.from('reminder_settings').upsert({
        subscriber_id: x.subscriberId,
        kind: 'steps-yesterday',
        local_time: '07:30',
      });
      if (error) throw error;
      await restoreDefaults(x.subscriberId);
    }

    const repointSetting = await x.client
      .from('reminder_settings')
      .update({ subscriber_id: y.subscriberId })
      .eq('subscriber_id', x.subscriberId)
      .eq('kind', 'bodyweight');
    expect(repointSetting.error).not.toBeNull();

    const repointPref = await x.client
      .from('reminder_preferences')
      .update({ subscriber_id: y.subscriberId })
      .eq('subscriber_id', x.subscriberId);
    expect(repointPref.error).not.toBeNull();

    expect(await actualRows(x.subscriberId)).toEqual(before);
    expect(await actualRows(y.subscriberId)).toEqual(yBefore);
  });

  it('refuses a time zone Postgres does not know, and keeps the old one', async () => {
    // Control: a valid zone in the same payload shape is accepted.
    try {
      const control = await x.client
        .from('reminder_preferences')
        .update({ time_zone: 'Asia/Tokyo' })
        .eq('subscriber_id', x.subscriberId)
        .select();
      expect(control.error).toBeNull();
      expect(control.data).toHaveLength(1);
    } finally {
      await restoreDefaults(x.subscriberId);
    }
    const before = await actualRows(x.subscriberId);

    const { error } = await x.client
      .from('reminder_preferences')
      .update({ time_zone: 'Mars/Olympus' })
      .eq('subscriber_id', x.subscriberId);
    expect(error).not.toBeNull();
    expect(await actualRows(x.subscriberId)).toEqual(before);
  });

  it('refuses an unknown time zone even from the service role', async () => {
    const { subscriberId } = await createThrowawaySubscriber(service);
    const control = await service
      .from('reminder_preferences')
      .update({ time_zone: 'Asia/Tokyo' })
      .eq('subscriber_id', subscriberId)
      .select();
    expect(control.error).toBeNull();
    expect(control.data).toHaveLength(1);

    const { error } = await service
      .from('reminder_preferences')
      .update({ time_zone: 'Mars/Olympus' })
      .eq('subscriber_id', subscriberId);
    expect(error).not.toBeNull();
    expect((await actualRows(subscriberId)).preferences[0].time_zone).toBe(
      'Asia/Tokyo'
    );
  });

  it('refuses an unknown time zone on insert too', async () => {
    const { subscriberId } = await createThrowawaySubscriber(service);
    const removed = await service
      .from('reminder_preferences')
      .delete()
      .eq('subscriber_id', subscriberId)
      .select();
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);

    const bad = await service
      .from('reminder_preferences')
      .insert({ subscriber_id: subscriberId, time_zone: 'Mars/Olympus' });
    expect(bad.error).not.toBeNull();

    // Control: the same payload with a real zone is accepted.
    const good = await service
      .from('reminder_preferences')
      .insert({ subscriber_id: subscriberId, time_zone: 'Asia/Tokyo' });
    expect(good.error).toBeNull();
  });

  it('refuses an unknown kind and an out-of-range time', async () => {
    const { subscriberId } = await createThrowawaySubscriber(service);
    const control = await service
      .from('reminder_settings')
      .update({ local_time: '06:15' })
      .eq('subscriber_id', subscriberId)
      .eq('kind', 'steps')
      .select();
    expect(control.error).toBeNull();

    const bad = await service
      .from('reminder_settings')
      .update({ kind: 'lunch' })
      .eq('subscriber_id', subscriberId)
      .eq('kind', 'steps');
    expect(bad.error).not.toBeNull();
  });
});

describe('isolation between Subscribers', () => {
  it("shows X none of Y's rows", async () => {
    const prefs = await readTable(x.client, 'reminder_preferences');
    const settings = await readTable(x.client, 'reminder_settings');
    expect(prefs.map((r) => r.subscriber_id)).toEqual([x.subscriberId]);
    expect(new Set(settings.map((r) => r.subscriber_id))).toEqual(
      new Set([x.subscriberId])
    );

    const byId = await x.client
      .from('reminder_settings')
      .select('*')
      .eq('subscriber_id', y.subscriberId);
    expect(byId.error).toBeNull();
    expect(byId.data).toEqual([]);
  });

  it("cannot update Y's rows, and Y's rows are unchanged", async () => {
    const before = await actualRows(y.subscriberId);

    // Control: Y can make these very changes to their own rows.
    try {
      const control = await y.client
        .from('reminder_settings')
        .update({ enabled: false, local_time: '05:00' })
        .eq('subscriber_id', y.subscriberId)
        .eq('kind', 'creatine')
        .select();
      expect(control.error).toBeNull();
      expect(control.data).toHaveLength(1);
      const controlPrefs = await y.client
        .from('reminder_preferences')
        .update({ time_zone: 'Asia/Tokyo' })
        .eq('subscriber_id', y.subscriberId)
        .select();
      expect(controlPrefs.error).toBeNull();
      expect(controlPrefs.data).toHaveLength(1);
    } finally {
      await restoreDefaults(y.subscriberId);
    }

    const settings = await x.client
      .from('reminder_settings')
      .update({ enabled: false, local_time: '05:00' })
      .eq('subscriber_id', y.subscriberId)
      .select();
    expect(settings.error).toBeNull();
    expect(settings.data).toEqual([]);

    const prefs = await x.client
      .from('reminder_preferences')
      .update({ time_zone: 'Asia/Tokyo' })
      .eq('subscriber_id', y.subscriberId)
      .select();
    expect(prefs.error).toBeNull();
    expect(prefs.data).toEqual([]);

    expect(await actualRows(y.subscriberId)).toEqual(before);
  });
});

describe.each([
  ['the Inactive Subscriber', inactive.client, inactive.subscriberId],
  ['the outsider', outsider.client, undefined],
] as const)('%s', (_name, client, ownSubscriberId) => {
  it('reads zero rows from both tables, without an error', async () => {
    expect(await readTable(client, 'reminder_preferences')).toEqual([]);
    expect(await readTable(client, 'reminder_settings')).toEqual([]);
  });

  it('cannot update, insert or delete rows', async () => {
    const before = await everyRow();
    // Control: X's equivalent update works, so the refusals aren't vacuous.
    try {
      const control = await x.client
        .from('reminder_settings')
        .update({ enabled: false })
        .eq('subscriber_id', x.subscriberId)
        .eq('kind', 'creatine')
        .select();
      expect(control.error).toBeNull();
      expect(control.data).toHaveLength(1);
    } finally {
      await restoreDefaults(x.subscriberId);
    }

    for (const subscriberId of [ownSubscriberId, x.subscriberId].filter(
      (id): id is string => !!id
    )) {
      const settings = await client
        .from('reminder_settings')
        .update({ enabled: false })
        .eq('subscriber_id', subscriberId)
        .select();
      expect(settings.data ?? []).toEqual([]);
      const prefs = await client
        .from('reminder_preferences')
        .update({ time_zone: 'Asia/Tokyo' })
        .eq('subscriber_id', subscriberId)
        .select();
      expect(prefs.data ?? []).toEqual([]);
    }

    const insert = await client.from('reminder_settings').insert({
      subscriber_id: ownSubscriberId ?? x.subscriberId,
      kind: 'steps',
      local_time: '22:00',
    });
    expect(insert.error).not.toBeNull();
    const del = await client.from('reminder_settings').delete().neq('kind', '');
    expect(del.error).not.toBeNull();

    expect(await everyRow()).toEqual(before);
  });
});

describe('an anonymous caller', () => {
  it('is refused outright on both tables', async () => {
    for (const table of ['reminder_preferences', 'reminder_settings']) {
      const read = await anon.from(table).select('*');
      expect(read.error).not.toBeNull();
      const write = await anon
        .from(table)
        .update({ time_zone: 'UTC' })
        .neq('subscriber_id', x.subscriberId);
      expect(write.error).not.toBeNull();
    }
  });
});
