-- Reminder preferences and settings (#47).
--
-- Every enrolled Subscriber has one time zone (`reminder_preferences`) and one
-- row per reminder kind (`reminder_settings`). The database creates all six
-- rows when a Subscriber row is inserted, so whoever enrols a Subscriber never
-- needs to know the defaults, and the reminder scheduler can find who is due
-- with a plain query. A reminder is turned off with `enabled = false`, never by
-- removing its row, so there is no user insert or delete.
--
-- This migration is additive: it is never edited once merged.

create table public.reminder_preferences (
  subscriber_id uuid not null
    constraint reminder_preferences_pkey primary key
    constraint reminder_preferences_subscriber_id_fkey
      references public.subscribers (id) on delete cascade,
  time_zone text not null default 'America/New_York'
);

comment on table public.reminder_preferences is
  'One row per Subscriber: the IANA time zone their reminder times are read in. Created with the Subscriber.';

create table public.reminder_settings (
  subscriber_id uuid not null
    constraint reminder_settings_subscriber_id_fkey
      references public.subscribers (id) on delete cascade,
  kind text not null
    constraint reminder_settings_kind_check
      check (kind in ('bodyweight', 'measurement', 'creatine', 'steps', 'steps-yesterday')),
  enabled boolean not null default true,
  local_time time not null,
  constraint reminder_settings_pkey primary key (subscriber_id, kind)
);

comment on table public.reminder_settings is
  'One row per Subscriber per reminder kind: whether it is on, and the local time of day it is sent. Created with the Subscriber; turned off with enabled = false.';

-- Refuses a time zone Postgres doesn't know. Checked on insert and whenever
-- time_zone is updated. pg_timezone_names is a view over the zone database and
-- can be slow to scan, but this runs once per row written, and the table is
-- written only when a Subscriber enrols or edits their time zone.
create function public.validate_reminder_time_zone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names z
    where z.name = new.time_zone
  ) then
    raise exception 'Unknown time zone: %', new.time_zone
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger reminder_preferences_validate_time_zone
  before insert or update of time_zone on public.reminder_preferences
  for each row execute function public.validate_reminder_time_zone();

-- Creates a new Subscriber's default rows. Deliberately NOT security definer:
-- Subscribers are inserted only by the service role (or postgres), which can
-- already insert into both tables, so the trigger runs with exactly the
-- inserter's own privileges and elevates nothing. A role that could insert
-- Subscribers but not these rows would fail loudly rather than silently
-- gaining access. The empty search_path means every name is schema-qualified.
create function public.create_default_reminder_rows()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.reminder_preferences (subscriber_id)
  values (new.id);

  insert into public.reminder_settings (subscriber_id, kind, local_time)
  values
    (new.id, 'bodyweight', time '07:00'),
    (new.id, 'measurement', time '07:00'),
    (new.id, 'steps-yesterday', time '07:30'),
    (new.id, 'creatine', time '21:00'),
    (new.id, 'steps', time '22:00');

  return new;
end;
$$;

create trigger subscribers_create_default_reminder_rows
  after insert on public.subscribers
  for each row execute function public.create_default_reminder_rows();

-- Backfill for Subscribers that existed before this migration (a stack that
-- was not reset). Idempotent: existing rows, including any a Subscriber has
-- since edited, are left alone.
insert into public.reminder_preferences (subscriber_id)
select s.id from public.subscribers s
on conflict do nothing;

insert into public.reminder_settings (subscriber_id, kind, local_time)
select s.id, d.kind, d.local_time
from public.subscribers s
cross join (
  values
    ('bodyweight', time '07:00'),
    ('measurement', time '07:00'),
    ('steps-yesterday', time '07:30'),
    ('creatine', time '21:00'),
    ('steps', time '22:00')
) as d (kind, local_time)
on conflict do nothing;

alter table public.reminder_preferences enable row level security;
alter table public.reminder_settings enable row level security;

-- anon gets nothing. authenticated may read, and update only the columns a
-- Subscriber legitimately edits: subscriber_id and kind are never granted, so
-- a client can't repoint or retype a row, whatever the RLS policy would allow.
-- There is no insert or delete grant. The service role keeps its own defaults.
revoke all on table public.reminder_preferences from anon, authenticated;
revoke all on table public.reminder_settings from anon, authenticated;
grant select on table public.reminder_preferences to authenticated;
grant update (time_zone) on table public.reminder_preferences to authenticated;
grant select on table public.reminder_settings to authenticated;
grant update (enabled, local_time) on table public.reminder_settings to authenticated;

create policy "Subscribers read their own reminder preferences"
  on public.reminder_preferences for select to authenticated
  using (subscriber_id = (select public.current_subscriber_id()));
create policy "Subscribers update their own reminder preferences"
  on public.reminder_preferences for update to authenticated
  using (subscriber_id = (select public.current_subscriber_id()))
  with check (subscriber_id = (select public.current_subscriber_id()));

create policy "Subscribers read their own reminder settings"
  on public.reminder_settings for select to authenticated
  using (subscriber_id = (select public.current_subscriber_id()));
create policy "Subscribers update their own reminder settings"
  on public.reminder_settings for update to authenticated
  using (subscriber_id = (select public.current_subscriber_id()))
  with check (subscriber_id = (select public.current_subscriber_id()));
