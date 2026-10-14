# ADR-0006: Keep Enrolment separate from Subscription Entitlement

## Status

Accepted 2026-10-14, while specifying the Supabase foundation (#44). Refines #6 decision 6.

## Context

#6 gives the Subscriber row a status of `active` and anticipates "lapsed and onboarding-in-progress users". Read naively, that puts payment state (lapsed) on the same field as the coaching relationship. But ADR-0003 already defines Subscription Entitlements, derived from Stripe, for full access, grace periods and 30 days of Read-Only Access with export. And #7 has the operator deliberately marking a Subscriber inactive when the coaching relationship ends, rather than relying on a removed share.

## Decision

The Subscriber row's status records only **Enrolment**: whether the person is a current client of the Coach Partner. It holds `active` or `inactive`, and later non-payment states such as onboarding may be added. Payment state never lives there; a Subscriber in Read-Only Access stays enrolled, and so does an Unlinked Subscriber.

Database tenancy resolves only enrolled Subscribers, so an Inactive Subscriber sees nothing at all, including their own App-Owned Data. Read and write gating by Subscription Entitlement is a separate layer added with Stripe.

## Considered Options

- **One status covering both enrolment and payment** (`active`, `lapsed`, `inactive`…): rejected. Stripe webhooks would then edit the same field the operator controls, and "lapsed but still allowed to export" would blur into "no access".
- **Inactive Subscribers keep read access to App-Owned Data**: rejected. Ending an Enrolment is a deliberate operator decision, so a clean cut that fails closed is simpler. The operator can export on the Subscriber's behalf.

## Consequences

- Ending a coaching relationship and a failed payment are handled by different mechanisms and can't overwrite each other.
- An Inactive Subscriber can't self-serve an export; that's an operator task.
- New Enrolment states (for example onboarding) are added by widening the status check, which is an additive migration.
