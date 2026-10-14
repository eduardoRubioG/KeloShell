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
