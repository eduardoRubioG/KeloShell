-- The Sheets write audit log (#48).
--
-- Every Sheets write will record which Subscriber wrote to which sheet, tab and
-- range, and when. The nightly check uses it to flag writes to a sheet the
-- writer doesn't own, and it supports incident investigation. The table exists
-- here; writing a row on each Sheets write is step 4.
--
-- It is append-only against the application roles (the service role included),
-- and it points at a stable Subscriber (ADR-0005), so a Subscriber with write history can't be
-- hard-deleted.

create table public.sheet_write_audit (
  id bigint generated always as identity primary key,
  -- Defaults to the caller's own Subscriber, like daily_steps, so server code
  -- writing with the user's token never has to send it. An Inactive Subscriber
  -- or outsider resolves to null: the default is null, not null refuses it, and
  -- the insert policy matches nothing for them.
  subscriber_id uuid not null
    default public.current_subscriber_id()
    constraint sheet_write_audit_subscriber_id_fkey
      references public.subscribers (id) on delete restrict,
  spreadsheet_id text not null,
  tab text not null,
  range text not null,
  operation text not null
    constraint sheet_write_audit_operation_check
      check (operation in ('write', 'clear')),
  written_at timestamptz not null default now()
);

comment on table public.sheet_write_audit is
  'Append-only log of Sheets writes: which Subscriber wrote to which spreadsheet, tab and range, and when. The application roles (authenticated, service_role) can neither update, delete nor truncate it; only the service role can read it. The table owner (postgres) and superusers can bypass the triggers.';
comment on column public.sheet_write_audit.spreadsheet_id is
  'The sheet actually written, deliberately not checked against the Subscriber''s own Source Spreadsheet, so a misdirected write is logged faithfully for the nightly check.';
comment on column public.sheet_write_audit.written_at is
  'Always set to now() by a before-insert trigger, whatever a client or the service role sends. The table owner and superusers can bypass the trigger.';

-- Append-only against the application roles. The row triggers refuse update
-- and delete; the statement trigger refuses truncate. Triggers aren't RLS, so
-- they fire for `service_role` as well as `authenticated`. They can be
-- bypassed by the table owner (`postgres`: it can disable them or set
-- `session_replication_role = replica`) and by superusers, i.e. anyone holding
-- the database password. The guarantee is against `authenticated` and
-- `service_role` only.
create function public.refuse_sheet_write_audit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'sheet_write_audit is append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger sheet_write_audit_append_only
  before update or delete on public.sheet_write_audit
  for each row execute function public.refuse_sheet_write_audit_change();

create trigger sheet_write_audit_no_truncate
  before truncate on public.sheet_write_audit
  for each statement execute function public.refuse_sheet_write_audit_change();

-- The timestamp is evidence: always the database's clock, never a value a
-- client or the service role sends. (`id` is generated always; only the table
-- owner or the service role over raw SQL with `overriding system value` could
-- choose one, and PostgREST can't.)
create function public.stamp_sheet_write_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.written_at := now();
  return new;
end;
$$;

create trigger sheet_write_audit_stamp
  before insert on public.sheet_write_audit
  for each row execute function public.stamp_sheet_write_audit();

alter table public.sheet_write_audit enable row level security;

-- anon gets nothing. authenticated may only insert, and only the columns the
-- caller legitimately chooses: `id` is generated and `written_at` always comes
-- from now(), because a client-supplied timestamp would weaken the evidence.
-- update and delete are withheld here as well as by the triggers. No select:
-- an insert must use `return=minimal` (supabase-js `.insert()` without
-- `.select()`).
revoke all on table public.sheet_write_audit from anon, authenticated;
grant insert (subscriber_id, spreadsheet_id, tab, range, operation)
  on table public.sheet_write_audit to authenticated;

-- Supabase also grants the service role everything on new tables. Withdraw the
-- privileges that would let it reshape the log: with `truncate`, `references`,
-- `trigger` and `maintain` it could (over SQL) attach its own trigger that
-- rewrites or blocks inserts. It keeps select (the nightly check), insert, and
-- update/delete, which the triggers above refuse.
revoke truncate, references, trigger, maintain
  on table public.sheet_write_audit from service_role;

create policy "Subscribers log their own writes"
  on public.sheet_write_audit
  for insert
  to authenticated
  with check (subscriber_id = (select public.current_subscriber_id()));
