-- Subscribers and the tenancy helper every RLS policy goes through (#45).
--
-- A Subscriber is separate from their Sign-In Account (ADR-0005): `id` is the
-- Subscriber's own immutable UUID, linked to Supabase Auth by `auth_user_id`.
-- `status` records only Enrolment (ADR-0006), never payment state.
--
-- Migrations are additive: this file is never edited once merged.

-- Fail closed by default. Supabase's default privileges grant every new table,
-- sequence and function in `public` to anon and authenticated, and Postgres
-- grants execute on every new function to PUBLIC. Withdraw all of that for
-- objects that migrations (which run as `postgres`) create from here on, so
-- each table and function must grant clients exactly what they need.
-- `supabase_admin` keeps its own defaults: `postgres` can't change them, and
-- only the platform creates objects as that role.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
-- PUBLIC's execute is a global default, so it can only be revoked globally.
alter default privileges for role postgres
  revoke execute on functions from public;

-- Keeps `updated_at` current on any table that has one. Later tables reuse it.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


create table public.subscribers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null
    constraint subscribers_auth_user_id_key unique
    constraint subscribers_auth_user_id_fkey
      references auth.users (id) on delete restrict,
  display_name text not null,
  source_spreadsheet_id text not null
    constraint subscribers_source_spreadsheet_id_key unique,
  coach_template text not null
    constraint subscribers_coach_template_check
      check (coach_template in ('coach-partner')),
  status text not null
    constraint subscribers_status_check
      check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscribers is
  'One row per Subscriber. Written only by the service role; a signed-in user may read their own row while their Enrolment is active.';
comment on column public.subscribers.id is
  'The Subscriber UUID: immutable, and the identity every App-Owned Data table references.';
comment on column public.subscribers.auth_user_id is
  'The Sign-In Account. Deleting the auth user is refused while the Subscriber exists.';
comment on column public.subscribers.status is
  'Enrolment only: active or inactive. Never payment state.';

create trigger subscribers_set_updated_at
  before update on public.subscribers
  for each row execute function public.set_updated_at();

-- The Subscriber UUID never changes (ADR-0005): it's the OneSignal external_id
-- and the target of the append-only audit log. Refused for every role,
-- the service role included.
create function public.refuse_subscriber_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'A Subscriber''s id is immutable'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger subscribers_keep_id
  before update on public.subscribers
  for each row execute function public.refuse_subscriber_id_change();

-- Maps the signed-in user to their Subscriber, only while the Enrolment is
-- active; null otherwise. Security definer so it can read `subscribers`
-- regardless of the caller's RLS, with a fixed, empty search_path so the body
-- can't be hijacked by objects in a caller-controlled schema.
create function public.current_subscriber_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.subscribers s
  where s.auth_user_id = auth.uid()
    and s.status = 'active'
$$;

-- Only signed-in users need it (RLS policies run it as the caller).
revoke execute on function public.current_subscriber_id() from public, anon;
grant execute on function public.current_subscriber_id() to authenticated, service_role;

alter table public.subscribers enable row level security;

-- The default privileges above already withhold everything; these statements
-- make the table's grants explicit. anon gets nothing, authenticated may only
-- select, and RLS narrows that select to the caller's own row. Only the
-- service role writes, so the Source Spreadsheet ID never comes from a client.
revoke all on table public.subscribers from anon, authenticated;
grant select on table public.subscribers to authenticated;

create policy "Subscribers read their own row"
  on public.subscribers
  for select
  to authenticated
  using (id = (select public.current_subscriber_id()));
