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
