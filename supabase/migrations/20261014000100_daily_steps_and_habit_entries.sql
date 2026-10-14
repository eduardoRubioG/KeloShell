-- App-Owned Data, first tables: daily steps and habit entries (#46).
--
-- Both are keyed by the Subscriber UUID (ADR-0005), which defaults to the
-- caller's own, so a client never has to send `subscriber_id`. An Inactive
-- Subscriber or outsider resolves to null: the default is null, the not-null
-- primary key refuses the insert, and RLS matches nothing for them.
--
-- A second value for the same date replaces the first (an upsert), and a Clear
-- is a hard delete: neither keeps history.

create table public.daily_steps (
  subscriber_id uuid not null
    default public.current_subscriber_id()
    constraint daily_steps_subscriber_id_fkey
      references public.subscribers (id) on delete cascade,
  local_date date not null,
  steps integer not null
    constraint daily_steps_steps_check check (steps > 0),
  updated_at timestamptz not null default now(),
  constraint daily_steps_pkey primary key (subscriber_id, local_date)
);

comment on table public.daily_steps is
  'One row per Subscriber per local date: that day''s step count. A later value replaces the earlier one.';

create trigger daily_steps_set_updated_at
  before update on public.daily_steps
  for each row execute function public.set_updated_at();

create table public.habit_entries (
  subscriber_id uuid not null
    default public.current_subscriber_id()
    constraint habit_entries_subscriber_id_fkey
      references public.subscribers (id) on delete cascade,
  habit text not null
    constraint habit_entries_habit_check check (habit in ('creatine')),
  local_date date not null,
  created_at timestamptz not null default now(),
  constraint habit_entries_pkey primary key (subscriber_id, habit, local_date)
);

comment on table public.habit_entries is
  'A row''s presence means the Subscriber did the habit on that local date. Clearing it deletes the row.';

alter table public.daily_steps enable row level security;
alter table public.habit_entries enable row level security;

-- Explicit grants: anon gets nothing, authenticated gets full CRUD, and RLS
-- narrows every statement to the caller's own rows.
revoke all on table public.daily_steps from anon, authenticated;
grant select, insert, update, delete on table public.daily_steps to authenticated;
revoke all on table public.habit_entries from anon, authenticated;
grant select, insert, update, delete on table public.habit_entries to authenticated;

create policy "Subscribers read their own steps"
  on public.daily_steps for select to authenticated
  using (subscriber_id = (select public.current_subscriber_id()));
create policy "Subscribers insert their own steps"
  on public.daily_steps for insert to authenticated
  with check (subscriber_id = (select public.current_subscriber_id()));
create policy "Subscribers update their own steps"
  on public.daily_steps for update to authenticated
  using (subscriber_id = (select public.current_subscriber_id()))
  with check (subscriber_id = (select public.current_subscriber_id()));
create policy "Subscribers delete their own steps"
  on public.daily_steps for delete to authenticated
  using (subscriber_id = (select public.current_subscriber_id()));

create policy "Subscribers read their own habit entries"
  on public.habit_entries for select to authenticated
  using (subscriber_id = (select public.current_subscriber_id()));
create policy "Subscribers insert their own habit entries"
  on public.habit_entries for insert to authenticated
  with check (subscriber_id = (select public.current_subscriber_id()));
create policy "Subscribers update their own habit entries"
  on public.habit_entries for update to authenticated
  using (subscriber_id = (select public.current_subscriber_id()))
  with check (subscriber_id = (select public.current_subscriber_id()));
create policy "Subscribers delete their own habit entries"
  on public.habit_entries for delete to authenticated
  using (subscriber_id = (select public.current_subscriber_id()));
