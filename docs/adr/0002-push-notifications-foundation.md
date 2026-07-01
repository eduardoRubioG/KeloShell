# ADR-0002: Web Push notifications foundation

## Status

Accepted

## Context

KeloShell needs to remind Eduardo to log his Daily Bodyweight and complete Measurement Check-Ins without requiring him to open the app. Because KeloShell is a Chrome-installed PWA with no app-specific accounts, any notification mechanism must work through the browser's own push infrastructure rather than a platform SDK.

The app runs entirely on Cloudflare Pages Functions, which do not support cron triggers. There was no existing push infrastructure, no server-side storage beyond the Source Spreadsheet, and no service worker push handlers.

## Decision

Implement the standard Web Push stack (RFC 8291 + RFC 8292 / VAPID) as the notification transport:

**Subscription storage — Cloudflare KV**
A new KV namespace (`PUSH_KV`) stores push subscriptions as a JSON array under the key `push:subscriptions`. Keeping subscriptions in KV rather than a Source Spreadsheet tab preserves the architectural boundary between app infrastructure and coach data.

**Server-side crypto — native Web Crypto**
`functions/lib/web-push.ts` implements VAPID JWT signing (ES256 via ECDSA P-256) and aes128gcm payload encryption (RFC 8291: ECDH key agreement → HKDF-based key derivation → AES-128-GCM) entirely with the Web Crypto API. No Node `crypto` dependency is used, so the code runs natively on the Cloudflare Workers runtime.

**API surface — four Pages Functions**
- `GET /api/push/vapid-public-key` — delivers the VAPID public key to the browser for `pushManager.subscribe()`
- `POST /api/push/subscribe` — validates and stores a new subscription in KV (deduplicates by endpoint)
- `POST /api/push/unsubscribe` — removes a subscription from KV by endpoint
- `POST /api/push/test` — sends a live push to all stored subscriptions, prunes any that return 404/410 (expired), and returns the push service HTTP statuses for diagnostics

All four routes sit behind the same Cloudflare Access / localhost-bypass auth pattern as the rest of the API.

**Service worker**
`public/sw.js` handles `push` events (parses the JSON payload, calls `showNotification` with rich options: vibrate, badge, requireInteraction, and Open/Dismiss actions) and `notificationclick` events (focuses or opens the PWA and clears the app badge).

**Scheduling — GitHub Actions dispatcher**
Cloudflare Pages Functions have no cron support. A GitHub Actions workflow calls
a secret-token-protected dispatch endpoint during both UTC hours that can
contain 7am in `America/New_York`. The endpoint enforces the local 7am window,
reads the Source Spreadsheet, sends only due reminders, and records successful
deliveries in KV by Local Calendar Date and reminder kind. Repeated scheduler
runs therefore provide retry tolerance without duplicate notifications.

## VAPID key management

- Public key stored as `VAPID_PUBLIC_KEY` in `wrangler.jsonc` `vars` (non-secret, required by the browser)
- Subject stored as `VAPID_SUBJECT` (`mailto:eduardo.rubio.jr85@gmail.com`) in `vars`
- Private key stored as a Cloudflare Pages secret (`VAPID_PRIVATE_KEY`); for local dev it goes in `.dev.vars` (gitignored)
- Keys generated once with `npx web-push generate-vapid-keys` and never rotated unless subscriptions are wiped

## Consequences

- Push subscriptions are tied to the VAPID keypair. Rotating the keypair invalidates all existing subscriptions; Eduardo must re-enable notifications on each device.
- Each installed PWA instance (device/browser) is its own subscription. Re-installing the PWA or clearing site data invalidates the subscription; the stale endpoint is pruned automatically on the next send attempt.
- Scheduled delivery depends on GitHub Actions and a Cloudflare Access service token. GitHub schedules are best-effort, so the workflow retries during the 7am local hour rather than assuming exact execution at 7:00:00.
- iOS push requires the PWA to be installed via Safari (iOS 16.4+). Chrome on iOS uses WebKit and follows the same constraint. Not currently targeted.
- The Web Crypto aes128gcm implementation has no external runtime dependencies and is fully unit-testable in the Workers environment.
