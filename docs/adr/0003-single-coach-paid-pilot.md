# ADR-0003: Evolve KeloShell into a single-coach paid pilot

## Status

Accepted

## Context

KeloShell is moving from private use by two people to a paid pilot for up to 50 clients of one Coach Partner. The coach must continue programming and reviewing client data in Google Sheets, while Subscribers need self-service identity, billing, onboarding, app-owned storage, and strict isolation from one another. Building generic multi-coach configuration and a coach portal before validating the pilot would add substantial scope without evidence that they are needed.

## Decision

Retain the Cloudflare-hosted PWA and same-origin spreadsheet proxy, with one shared Google service account for the pilot. Each Subscriber has one active Source Spreadsheet, and the coach shares it directly with both the Subscriber's verified Account Email and the service account. KeloShell uses Google Drive permissions to verify that relationship and validates the sheet against one flexible Supported Spreadsheet Format before starting onboarding access.

Use Supabase Auth passwordless email links for Subscriber identity and Supabase Postgres for account records, verified sheet mappings, Subscription Entitlements, onboarding state, notification preferences, and App-Owned Data such as steps and habit entries. Keep coach-managed Program Definitions, Lift Logs, Daily Bodyweight, and Measurement Check-Ins authoritative in the Source Spreadsheet.

Use Stripe for one direct-to-Subscriber monthly subscription with a card-upfront trial. Trialing and active Subscribers receive full access; failed payments receive a retry grace period; ended subscriptions receive 30 days of Read-Only Access and export before becoming reactivation-only. Retain dormant app-owned records for 90 days while permitting export and deletion at any time.

Use OneSignal as the push delivery provider while KeloShell retains responsibility for reminder eligibility, Subscriber-controlled schedules, and Local Calendar Dates. The Coach Partner remains entirely in Google Sheets; the pilot has no coach account or portal. Enrollment uses one private coach referral link and proceeds in staged cohorts. Multi-coach support, coach-specific runtime configuration, and the standalone History feature are outside the pilot; Measurement Check-Ins are in scope.

## Consequences

- Cloudflare Access no longer provides Subscriber identity, although it may still protect private operational surfaces.
- The existing custom Web Push transport and per-user metadata spreadsheets will be retired.
- Supabase row-level security and server-side tenant resolution must prevent cross-Subscriber access.
- Google Sheets request caching, concurrent-request deduplication, exponential backoff, and quota monitoring are required before broad rollout.
- A shared service account is adequate for the pilot but creates a cross-client security and quota blast radius that must be revisited before multi-coach expansion.
- Direct email sharing is part of the Supported Spreadsheet Format's onboarding contract; link, group, and visitor-only access are unsupported.
- OneSignal does not remove platform requirements for PWA push, including iOS home-screen installation and user-initiated permission prompts.
