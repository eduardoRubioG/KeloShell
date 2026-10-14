import { describe, expect, it } from 'vitest';

import { getFixtures, throwawayValue } from './support/fixtures';

const { x, outsider, service } = getFixtures();

/**
 * Every table that holds a Subscriber's data or audits their writes. A new
 * table must be added here. The Supabase foundation spec requires that an
 * outsider (the shape of a future coach-only account) sees zero rows in every
 * table.
 */
const TABLES = [
  'subscribers',
  'daily_steps',
  'habit_entries',
  'reminder_preferences',
  'reminder_settings',
  'sheet_write_audit',
] as const;

/** Makes sure the table holds at least one row, so zero rows is meaningful. */
async function seed(table: (typeof TABLES)[number]): Promise<void> {
  switch (table) {
    case 'subscribers':
    case 'reminder_preferences':
    case 'reminder_settings':
      return; // X's fixture provisioning creates these.
    case 'daily_steps': {
      const { error } = await service.from(table).upsert({
        subscriber_id: x.subscriberId,
        local_date: '2026-01-01',
        steps: 1000,
      });
      if (error) throw error;
      return;
    }
    case 'habit_entries': {
      const { error } = await service.from(table).upsert({
        subscriber_id: x.subscriberId,
        habit: 'creatine',
        local_date: '2026-01-01',
      });
      if (error) throw error;
      return;
    }
    case 'sheet_write_audit': {
      const { error } = await service.from(table).insert({
        subscriber_id: x.subscriberId,
        spreadsheet_id: throwawayValue('sheet'),
        tab: 'Tracking',
        range: 'A1',
        operation: 'write',
      });
      if (error) throw error;
    }
  }
}

describe('a signed-in account with no Subscriber', () => {
  it.each(TABLES)('sees no rows in %s', async (table) => {
    await seed(table);
    const { count, error } = await service
      .from(table)
      .select('*', { count: 'exact', head: true });
    expect(error).toBeNull();
    expect(count).toBeGreaterThan(0);

    const { data, error: readError } = await outsider.client
      .from(table)
      .select('*');
    if (readError) {
      expect(readError.code).toBe('42501');
    } else {
      expect(data).toEqual([]);
    }
  });
});
