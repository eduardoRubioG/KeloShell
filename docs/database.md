# Database

KeloShell keeps App-Owned Data in Supabase Postgres, protected by row-level
security (RLS). The Source Spreadsheet stays the source of truth for workout and
bodyweight data; this database holds only what KeloShell owns.

The schema is built from `supabase/migrations/` alone (`npx supabase db reset`).
There is no seed file: the isolation suite in `supabase/tests/` creates its own
fixtures.

Each table section below lists its columns, its RLS policy and the reason for
both. Add a section for every new table.

## Rules every table follows

- **Tenancy goes through `current_subscriber_id()`.** No policy compares to
  `auth.uid()` directly (ADR-0005).
- **Tables reference `subscribers.id`, never `auth.users.id`.** The Subscriber
  UUID is the identity everywhere in KeloShell; the Sign-In Account can be
  replaced.
- **Fail closed.** A caller without an active Enrolment resolves to `null`, and
  `id = null` matches nothing, so they see zero rows everywhere.
- **Clients get nothing unless a migration grants it.** Out of the box,
  Supabase's default privileges grant every new table, sequence and function in
  `public` to `anon` and `authenticated`, and Postgres lets `PUBLIC` execute
  every new function. The first migration withdraws those defaults for objects
  created by `postgres`, the role migrations run as. So **every new table and
  function must `grant` explicitly what clients need** (for example
  `grant select on table public.x to authenticated`, or `grant execute` on a
  function an RLS policy calls). Without the grant, clients get a permission
  error. RLS then narrows table grants to the caller's rows. `anon` gets
  nothing. `supabase_admin` keeps its own defaults, but `postgres` can't change
  them and only the platform creates objects as that role.
- **`updated_at` is kept by a trigger.** Tables with an `updated_at` column use
  the shared `public.set_updated_at()` trigger function.
- **Additive migrations only.** A migration adds tables, columns, functions,
  policies or wider checks. Merged migrations are never edited. Drops, renames
  and narrowed checks ship later, in their own migration, once nothing depends
  on the old shape.

## `current_subscriber_id()`

```sql
current_subscriber_id() returns uuid  -- stable security definer, search_path = ''
```

Returns the `id` of the Subscriber whose `auth_user_id` is `auth.uid()` **and**
whose `status` is `'active'`; otherwise `null`.

Why it exists:

- **One place for tenancy.** Every RLS policy asks it who the caller is, so the
  mapping from Sign-In Account to Subscriber, and the Enrolment check, live in
  one function instead of being repeated in every policy (ADR-0005).
- **Inactive Subscribers fail closed.** Ending an Enrolment cuts off all access,
  including to the Subscriber's own App-Owned Data (ADR-0006). Payment state
  never affects it; Subscription Entitlement gating is a separate layer.
- **Outsiders fail closed.** A Sign-In Account with no Subscriber row (a
  referral signup mid-flow, a waitlisted person, the coach) gets `null`.

Why it's built this way:

- **`security definer`** so it can read `subscribers` whatever the caller's own
  RLS allows, and without recursing through the `subscribers` select policy.
- **`set search_path = ''`** with schema-qualified names, so a caller can't
  shadow `subscribers` or `auth.uid()` with objects of their own.
- **`stable`** so Postgres can evaluate it once per statement. Policies call it
  as `(select public.current_subscriber_id())` so the planner caches the result
  rather than calling it per row.
- **Execute is granted to `authenticated` and `service_role` only.** RLS runs it
  as the caller, so signed-in users need it; `anon` has no policies that call it.

## `subscribers`

One row per Subscriber. Written only by the service role.

| Column                  | Type          | Constraints                                                                        |
| ----------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `id`                    | `uuid`        | Primary key, default `gen_random_uuid()`. The Subscriber UUID; immutable.          |
| `auth_user_id`          | `uuid`        | Not null, unique, FK → `auth.users(id)` `on delete restrict`.                      |
| `display_name`          | `text`        | Not null.                                                                          |
| `source_spreadsheet_id` | `text`        | Not null, unique.                                                                  |
| `coach_template`        | `text`        | Not null, check in (`'coach-partner'`).                                            |
| `status`                | `text`        | Not null, check in (`'active'`, `'inactive'`). Enrolment only.                     |
| `created_at`            | `timestamptz` | Not null, default `now()`.                                                         |
| `updated_at`            | `timestamptz` | Not null, default `now()`, maintained by the `subscribers_set_updated_at` trigger. |

Why:

- **`id` is separate from `auth_user_id`** (ADR-0005). The Subscriber UUID is
  the future OneSignal `external_id` and the target of the append-only audit
  log, so it must never change. Replacing a Sign-In Account means repointing
  `auth_user_id`.
- **`id` can't change**, even by the service role: the
  `subscribers_keep_id` trigger refuses any update that changes it.
- **`on delete restrict`** means deleting a Sign-In Account that still has a
  Subscriber is refused, rather than cascading into the Subscriber's data or
  audit history.
- **`auth_user_id` is unique**: one Subscriber per Sign-In Account. A Sign-In
  Account may have no Subscriber at all.
- **`source_spreadsheet_id` is unique**: two Subscribers can never write to the
  same Source Spreadsheet.
- **`status` records Enrolment, not payment** (ADR-0006). New Enrolment states
  are added by widening the check, which is an additive migration.
- **No email column.** The Account Email lives in `auth.users`.

Privileges and RLS:

| Role            | Privileges | Policy                                                             |
| --------------- | ---------- | ------------------------------------------------------------------ |
| `anon`          | none       | none                                                               |
| `authenticated` | `select`   | Select where `id = current_subscriber_id()`: the caller's own row. |
| `service_role`  | all        | Bypasses RLS.                                                      |

There are no user insert, update or delete policies, and `authenticated` holds
no write privileges. A Subscriber can't enrol themselves, reactivate an ended
Enrolment, or point their row at another Source Spreadsheet: the Source
Spreadsheet ID never comes from a client.

### Offboarding a Subscriber

To end a Subscriber's access, set `status = 'inactive'`. It takes effect
immediately: `current_subscriber_id()` returns `null` on their very next request,
even with an access token that hasn't expired.

**Never soft-delete the Sign-In Account** (`auth.admin.deleteUser(id, true)`).
A soft delete doesn't remove the `auth.users` row, so `on delete restrict`
doesn't stop it. It succeeds, leaves the Subscriber `active`, and the
Subscriber's already-issued access tokens keep working until they expire.

Open question for step 4 (production Auth): should `current_subscriber_id()`
also require `auth.users.deleted_at is null`? It doesn't today.

What the isolation suite proves (`supabase/tests/subscribers.test.ts`):

- X reads exactly X's row, and Y's row is invisible to X even by id.
- The Inactive Subscriber and the outsider read zero rows, and the read itself
  succeeds. An anonymous caller's read is refused outright.
- `current_subscriber_id()` returns X's id to X and Y's to Y, `null` to the
  Inactive Subscriber and the outsider, and refuses an anonymous caller.
- No caller can insert a row, update any row (including their own
  `source_spreadsheet_id` or `status`) or delete a row.
- A second Subscriber with an existing `source_spreadsheet_id`, or for a Sign-In
  Account that already has one, is refused.
- Deleting a Sign-In Account that has a Subscriber row is refused (hard delete).
- Changing a Subscriber's `id` is refused, even from the service role.

## `daily_steps`

One row per Subscriber per local date: that day's step count. App-Owned Data.

| Column          | Type          | Constraints                                                                              |
| --------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `subscriber_id` | `uuid`        | Not null, FK → `subscribers(id)` `on delete cascade`, default `current_subscriber_id()`. |
| `local_date`    | `date`        | Not null. The Subscriber's own calendar day.                                             |
| `steps`         | `integer`     | Not null, check `> 0`.                                                                   |
| `updated_at`    | `timestamptz` | Not null, default `now()`, maintained by the `daily_steps_set_updated_at` trigger.       |

Primary key: `(subscriber_id, local_date)`.

## `habit_entries`

One row per Subscriber, habit and local date. A row's presence means the habit
was done that day. App-Owned Data.

| Column          | Type          | Constraints                                                                              |
| --------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `subscriber_id` | `uuid`        | Not null, FK → `subscribers(id)` `on delete cascade`, default `current_subscriber_id()`. |
| `habit`         | `text`        | Not null, check in (`'creatine'`). New habits widen the check in a later migration.      |
| `local_date`    | `date`        | Not null.                                                                                |
| `created_at`    | `timestamptz` | Not null, default `now()`.                                                               |

Primary key: `(subscriber_id, habit, local_date)`.

### Privileges and RLS (both tables)

| Role            | Privileges                             | Policies                                                                                                                   |
| --------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `anon`          | none                                   | none                                                                                                                       |
| `authenticated` | `select`, `insert`, `update`, `delete` | One policy per command, each `subscriber_id = current_subscriber_id()`, as both `using` and `with check` where both apply. |
| `service_role`  | all                                    | Bypasses RLS.                                                                                                              |

Why:

- **A Subscriber fully manages their own rows and touches no one else's.** The
  `with check` also stops an insert or update from pointing a row at another
  Subscriber.
- **Clients never send `subscriber_id`.** The default is the caller's own
  Subscriber id. For an Inactive Subscriber or an outsider it is `null`, so the
  insert fails the not-null primary key and RLS, and they read and change
  nothing (ADR-0006).
- **A second value for the same date replaces the first.** An Edit overwrites
  rather than keeping history, so writes are upserts. With `supabase-js`, name
  the conflict target and omit `subscriber_id`:
  `upsert(row, { onConflict: 'subscriber_id,local_date' })` (for habit entries,
  `'subscriber_id,habit,local_date'`). The omitted column takes its default, so
  the conflict is found on the caller's own row. The upsert needs the insert,
  update and select grants and policies above.
- **A Clear is a hard delete.** Removing a value deletes the row; nothing is
  kept as history.
- **Bulk inserts must not mix rows with and without `subscriber_id`.** PostgREST
  fills a column missing from some rows of one request with `null`, not the
  default, and the insert is then refused. Send the same keys on every row.
- **`on delete cascade`** removes a Subscriber's rows with the Subscriber. In
  practice Subscribers are set inactive, not deleted.

What the isolation suite proves (`supabase/tests/app-owned-data.test.ts`, run
against both tables):

- X inserts without `subscriber_id` (the row is stored as X's), reads, updates
  and deletes their own rows; a Clear leaves no row behind.
- A second value for the same date replaces the first through an upsert, and
  `daily_steps.updated_at` advances.
- X reads none of Y's rows, can't insert a row with Y's `subscriber_id`, can't
  move their own row to Y's, and can't update or delete Y's rows (checked
  against the real rows afterwards).
- The Inactive Subscriber and the outsider read zero rows with no error, and
  can neither insert nor change rows. An anonymous caller is refused outright.
- `steps` of 0 or less and an unknown habit are refused.

Each refusal test has a positive control, so a broken payload can't pass it.

## `reminder_preferences`

One row per Subscriber: the IANA time zone their reminder times are read in.
App-Owned Data.

| Column          | Type   | Constraints                                                             |
| --------------- | ------ | ----------------------------------------------------------------------- |
| `subscriber_id` | `uuid` | Primary key, FK → `subscribers(id)` `on delete cascade`.                |
| `time_zone`     | `text` | Not null, default `'America/New_York'`. Must be in `pg_timezone_names`. |

## `reminder_settings`

One row per Subscriber per reminder kind: whether it is on, and the local time of
day it is sent. App-Owned Data.

| Column          | Type      | Constraints                                                                                         |
| --------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `subscriber_id` | `uuid`    | Not null, FK → `subscribers(id)` `on delete cascade`.                                               |
| `kind`          | `text`    | Not null, check in (`'bodyweight'`, `'measurement'`, `'creatine'`, `'steps'`, `'steps-yesterday'`). |
| `enabled`       | `boolean` | Not null, default `true`.                                                                           |
| `local_time`    | `time`    | Not null. The Subscriber's local time of day, read in their `time_zone`.                            |

Primary key: `(subscriber_id, kind)`.

### Default rows

Inserting a Subscriber creates their preferences row and all five settings rows,
all enabled, with today's behaviour:

| Kind              | Local time |
| ----------------- | ---------- |
| `bodyweight`      | 07:00      |
| `measurement`     | 07:00      |
| `steps-yesterday` | 07:30      |
| `creatine`        | 21:00      |
| `steps`           | 22:00      |

The time zone defaults to `America/New_York`.

Why a trigger creates them:

- **Whoever enrols a Subscriber doesn't need to know the defaults.** The
  enrol script (step 4) inserts one `subscribers` row and the database does the
  rest, in the same transaction, so a Subscriber never exists without settings.
- **The reminder scheduler (step 5) can find who is due with a plain query.** Every Subscriber has
  every row, so "who gets `steps` at 22:00 in their own time zone" is a join on
  `reminder_settings` and `reminder_preferences`, with no "missing row means
  default" case to handle.
- **The trigger function is not `security definer`.** Subscribers are inserted
  only by the service role, which can already write both tables, so the function
  runs with the inserter's own privileges and elevates nothing. It sets
  `search_path = ''` and schema-qualifies every name.

The migration also **backfills** both tables for Subscribers that already exist
(`insert ... select from subscribers ... on conflict do nothing`), so it is
correct on a database that wasn't reset. It is idempotent and never overwrites a
row a Subscriber has edited.

### Privileges and RLS (both tables)

| Role            | Privileges                                                                   | Policies                                                                          |
| --------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `anon`          | none                                                                         | none                                                                              |
| `authenticated` | `select`; column-level `update (time_zone)` / `update (enabled, local_time)` | Select and update where `subscriber_id = current_subscriber_id()`, own rows only. |
| `service_role`  | all                                                                          | Bypasses RLS.                                                                     |

Why:

- **No user insert or delete.** The rows exist from enrolment on. A reminder is
  turned off with `enabled = false`, never by removing its row, so the scheduler
  never has to tell "off" from "missing".
- **`subscriber_id` and `kind` can't be changed by a client.** Column-level
  grants withhold `update` on them, on top of the RLS `using`/`with check`, so a
  Subscriber can't repoint or retype a row at all.
- **An invalid time zone is refused.** A `before insert or update of time_zone`
  trigger checks the value against `pg_timezone_names` (the zone names Postgres
  itself understands, so the scheduler can always convert with them). It
  applies to every role, the service role included. `pg_timezone_names` can be
  slow to scan, so the check is a single `exists` on the name and only runs when
  a row is inserted or its `time_zone` is written.
- **Inactive Subscribers and outsiders see nothing** (ADR-0006), and their rows
  are not changed by anyone but the service role.
- **Not here:** reminder deduplication ("last sent") belongs to the reminder scheduler (step 5).

What the isolation suite proves (`supabase/tests/reminder-settings.test.ts`):

- A new Subscriber gets exactly the default preferences row and five settings.
- X reads and updates their own time zone and settings (creatine off, steps to
  21:30), and the suite restores X's and Y's defaults afterwards.
- X reads none of Y's rows and updates none (Y's rows are checked unchanged).
- X can't insert or delete rows in either table, nor change a row's
  `subscriber_id` or `kind`.
- `Mars/Olympus` is refused on update and on insert, and an unknown kind is
  refused.
- The Inactive Subscriber and the outsider read zero rows with no error, and
  can't write. An anonymous caller is refused outright.

Each refusal test has a positive control, so a broken payload can't pass it.

## `sheet_write_audit`

The write audit log the isolation rules require (#8). Every Sheets write will record which Subscriber wrote
to which sheet, tab and range, and when. The nightly check uses it to flag
writes to a sheet the writer doesn't own, and it supports incident
investigation. This table is built here; writing a row on each Sheets write is
step 4.

| Column           | Type          | Notes                                                                                  |
| ---------------- | ------------- | -------------------------------------------------------------------------------------- |
| `id`             | `bigint`      | Primary key, `generated always as identity`: a client can't set it.                    |
| `subscriber_id`  | `uuid`        | Not null, default `current_subscriber_id()`, FK to `subscribers` `on delete restrict`. |
| `spreadsheet_id` | `text`        | Not null. The sheet actually written; not checked against the Subscriber.              |
| `tab`            | `text`        | Not null.                                                                              |
| `range`          | `text`        | Not null.                                                                              |
| `operation`      | `text`        | Not null, check `in ('write', 'clear')`.                                               |
| `written_at`     | `timestamptz` | Not null, default `now()`. Always set by the database.                                 |

Privileges and RLS:

| Role            | Privileges                                                                   | Policy                                                                         |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `anon`          | none                                                                         | none                                                                           |
| `authenticated` | column-level `insert (subscriber_id, spreadsheet_id, tab, range, operation)` | Insert only where `subscriber_id = current_subscriber_id()`. No select policy. |
| `service_role`  | `select`, `insert`, `update`, `delete` (the triggers refuse the last two)    | Bypasses RLS; triggers still apply.                                            |

Why:

- **The spreadsheet ID is deliberately not checked.** A write to a sheet the
  Subscriber doesn't own is exactly what the nightly check exists to catch. If
  the insert were refused, the misdirected write would go unlogged. So the log
  records what was sent, and only `subscriber_id` is tied to the caller.
- **No user `select`.** Subscribers can't read the log, not even their own rows.
  Only the service role reads it (the nightly check). Because `authenticated`
  has no `select` privilege, a read is refused outright. For the same reason an
  insert must not ask for the row back: use `return=minimal` (supabase-js
  `.insert(row)` without `.select()`), or it fails.
- **`written_at` and `id` come from the database.** The grant covers only the
  five columns a caller chooses, so a client-supplied timestamp is refused. A
  `before insert` trigger also overwrites `written_at` with `now()` for every
  role, so even the service role can't backdate a row through PostgREST. The
  log is evidence and a forgeable time would weaken it. `id` is
  `generated always`; only the table owner or the service role over raw SQL
  (`overriding system value`) could choose one, never a client or PostgREST.
- **`subscriber_id` defaults to the caller**, like `daily_steps`, so server
  code writing with the user's token never has to send it. The Inactive
  Subscriber and an outsider resolve to `null` and are refused.

### Append-only

- A `before update or delete` row trigger and a `before truncate` statement
  trigger raise (SQLSTATE `42501`) for `authenticated` and `service_role`. Triggers
  aren't RLS, so the service role doesn't bypass them. The truncate trigger also
  fires when a truncate cascades from another table.
- `update`, `delete`, `truncate`, `references` and `trigger` are revoked from
  `authenticated`. From `service_role` we revoke `truncate`, `references`,
  `trigger` and `maintain`, so it can't attach a trigger of its own that blocks
  or rewrites inserts. (`update` and `delete` stay granted to it so the
  triggers are the refusing layer.)
- The trigger functions have `set search_path = ''`.

These guarantees hold against the application roles (`authenticated` and
`service_role`). They don't hold against the table owner `postgres` or against
superusers, which in practice means anyone with the database password. `postgres`
is not a superuser on Supabase, but as owner it can disable the triggers, set
`session_replication_role = replica` (which skips triggers and foreign-key
checks), or update, delete and truncate directly. Treat access to the database
password as outside the threat model of this log.

### Deleting a Subscriber

The foreign key is `on delete restrict`, so **a Subscriber with any write
history can't be hard-deleted**. Deleting a Subscriber who has audit rows is
refused as a whole: nothing is removed, including the rows that would otherwise
cascade (steps, habits, reminders). Even if the key were changed to cascade, the
delete trigger would still refuse. ADR-0003's "deletion at any time" will
therefore mean deleting App-Owned Data and the Sign-In Account, not the audit
trail. The privacy terms (#13) decide whether "deletion at any time" keeps the
audit trail.

What the isolation suite proves (`supabase/tests/sheet-write-audit.test.ts`):

- X can log a write for themselves, stored as sent, with `written_at` from the
  database; `subscriber_id` defaults to X.
- X can log a write whose spreadsheet ID is Y's, and the row is stored as sent.
- X can't insert a row with Y's `subscriber_id`, a `written_at`, an `id`, an
  unknown `operation`, or ask for the row back.
- X (and everyone else signed in) can't read any audit rows, including their own.
- X can't update or delete a row. Acted as X over SQL (`psql` as `authenticated`
  with X's JWT claims), both fail with permission denied (`42501`) and the row is
  unchanged. A plain supabase-js update would fail for lack of `select` whatever
  the rules, so it can't prove this.
- The service role can read rows, but its update, delete and truncate attempts
  fail and the rows are unchanged, and it can't create a trigger on the table.
  It can't backdate `written_at` either. Truncate and `create trigger` run
  through `psql` as `service_role`, since supabase-js can't send them. The
  suite reads the database URL from `DB_URL`, else `supabase status`, else the
  local default, and refuses a non-local host.
- Deleting a Subscriber with audit rows is refused, and the Subscriber and their
  other rows remain. The error is SQLSTATE `23503` (foreign key).
- The Inactive Subscriber, the outsider and anon can't insert.

`supabase/tests/cross-cutting.test.ts` also checks that a signed-in account with
no Subscriber sees no rows in any table, this one included.

Rows accumulate across runs (the table is append-only), so the tests identify
their rows by a unique spreadsheet ID or tab and never assert on totals.
