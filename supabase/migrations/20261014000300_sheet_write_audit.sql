-- The Sheets write audit log (#48, from #8).
--
-- Every Sheets write will record which Subscriber wrote to which sheet, tab and
-- range, and when. The nightly check uses it to flag writes to a sheet the
-- writer doesn't own, and it supports incident investigation. The table exists
-- here; writing a row on each Sheets write is step 4.
--
-- It is append-only for every role, the service role included, and it points at
-- a stable Subscriber (ADR-0005), so a Subscriber with write history can't be
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
  'Append-only log of Sheets writes: which Subscriber wrote to which spreadsheet, tab and range, and when. No role can update, delete or truncate it, and nobody but the service role can read it.';
comment on column public.sheet_write_audit.spreadsheet_id is
  'The sheet actually written, deliberately not checked against the Subscriber''s own Source Spreadsheet, so a misdirected write is logged faithfully for the nightly check.';
comment on column public.sheet_write_audit.written_at is
  'Always set by the database (now()); clients may not supply it.';

-- Append-only, for every role. The row triggers refuse update and delete; the
-- statement trigger refuses truncate. Triggers fire for the service role and
-- for postgres alike (they are not RLS). They are bypassed only by
-- `session_replication_role = replica`, which needs superuser, so the
-- guarantee is against application roles, not database superusers.
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

create policy "Subscribers log their own writes"
  on public.sheet_write_audit
  for insert
  to authenticated
  with check (subscriber_id = (select public.current_subscriber_id()));
