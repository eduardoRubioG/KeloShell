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
- **Withdraw default privileges.** Supabase grants every table privilege to
  `anon` and `authenticated` by default. Each table revokes them and grants back
  only what its policies need. RLS then narrows those grants to the caller's
  rows. `anon` gets nothing.
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

What the isolation suite proves (`supabase/tests/subscribers.test.ts`):

- X reads exactly X's row, and Y's row is invisible to X even by id.
- The Inactive Subscriber, the outsider and an anonymous caller read zero rows.
- No caller can insert a row, update any row (including their own
  `source_spreadsheet_id` or `status`) or delete a row.
- A second Subscriber with an existing `source_spreadsheet_id`, or for a Sign-In
  Account that already has one, is refused.
- Deleting a Sign-In Account that has a Subscriber row is refused.
