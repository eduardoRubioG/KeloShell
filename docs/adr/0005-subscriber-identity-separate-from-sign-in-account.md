# ADR-0005: Keep the Subscriber's identity separate from their Sign-In Account

## Status

Accepted 2026-10-14, while specifying the Supabase foundation (#44).

## Context

The obvious Supabase pattern makes the Subscriber row's primary key the Supabase Auth user ID, so every RLS policy reads `subscriber_id = auth.uid()`. But in KeloShell the Subscriber has to outlive and stand apart from the account they sign in with:

- The Sheets write audit log is append-only and must point at a stable Subscriber. Removing a Sign-In Account must never cascade into it or be blocked by it.
- The Subscriber UUID is the OneSignal `external_id` (#10), which assumes it never changes.
- ADR-0003 plans for dormant Subscribers and account deletion.
- Sign-In Accounts exist without a Subscriber: referral signups mid-flow, waitlisted people, and the Coach Partner's coach access (ADR-0003 amendment).

## Decision

`subscribers.id` is its own immutable UUID, the Subscriber's identity everywhere in KeloShell. It links to Supabase Auth through a separate, unique `auth_user_id` column that refuses deletion of the auth user while the Subscriber exists. RLS never compares to `auth.uid()` directly. It goes through one `current_subscriber_id()` helper, which maps the signed-in user to their Subscriber, and only when their Enrolment is active (ADR-0006).

## Consequences

- Every App-Owned Data table and the audit log reference `subscribers.id`, never `auth.users.id`. Switching later would mean rekeying every table.
- All tenancy resolution lives in one helper, which is also where the Enrolment check is enforced.
- A Sign-In Account can be replaced, for example after a lost email address, by repointing `auth_user_id`. The Subscriber, their data and their audit history stay unchanged.
- One auth user can later be both a Subscriber and the coach. Step 8 decides where the coach role lives.
