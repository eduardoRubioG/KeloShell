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
a secret-token-protected dispatch endpoint during UTC hours that bracket both
the Bodyweight/Measurement window (7am `America/New_York`) and the Creatine
window (9pm `America/New_York`). GitHub scheduled runs have been observed
landing 1-3 hours after every candidate slot (sometimes coalesced into a
single run for the whole day), so the endpoint evaluates each reminder kind
independently against its own "no earlier than" local hour rather than
requiring an exact hour match. Bodyweight and Measurement read the Source
Spreadsheet; Creatine reads the `Habits` sheet in the separate KeloShell meta
database spreadsheet (the same one `POST /api/creatine-log` writes to) and is
due when today has no `creatine` row. Successful deliveries are recorded in KV
by Local Calendar Date and reminder kind, so repeated scheduler runs — for
either window, on the same or different calls — provide retry tolerance
without duplicate notifications, even when every run for the day is delayed
well past its target hour.

## VAPID key management

- Public key stored as `VAPID_PUBLIC_KEY` in `wrangler.jsonc` `vars` (non-secret, required by the browser)
- Subject stored as `VAPID_SUBJECT` (`mailto:eduardo.rubio.jr85@gmail.com`) in `vars`
- Private key stored as a Cloudflare Pages secret (`VAPID_PRIVATE_KEY`); for local dev it goes in `.dev.vars` (gitignored)
- Keys generated once with `npx web-push generate-vapid-keys` and never rotated unless subscriptions are wiped

## Consequences

- Push subscriptions are tied to the VAPID keypair. Rotating the keypair invalidates all existing subscriptions; Eduardo must re-enable notifications on each device.
- Each installed PWA instance (device/browser) is its own subscription. Re-installing the PWA or clearing site data invalidates the subscription; the stale endpoint is pruned automatically on the next send attempt.
- Scheduled delivery depends on GitHub Actions and a Cloudflare Access service token. GitHub schedules are best-effort and can run hours late or be coalesced to one firing per day, so the dispatch endpoint treats "at or after" each reminder kind's local hour (7am for Bodyweight/Measurement, 9pm for Creatine) as due rather than requiring the run to land inside a specific hour.
- The Creatine reminder depends on `KELOSHELL_META_DB_SHEET` being configured; if it is unset the dispatch endpoint silently skips creatine evaluation rather than failing Bodyweight/Measurement delivery.
- iOS push requires the PWA to be installed via Safari (iOS 16.4+). Chrome on iOS uses WebKit and follows the same constraint. Not currently targeted.
- The Web Crypto aes128gcm implementation has no external runtime dependencies and is fully unit-testable in the Workers environment.

## Troubleshooting: scheduled dispatch returns a Cloudflare Access 302

If the reminder workflow (or a manual `curl`) to `/api/push/dispatch-reminders`
returns an HTTP `302` redirecting to
`https://<team>.cloudflareaccess.com/cdn-cgi/access/login/keloshell.pages.dev`,
Cloudflare Access is rejecting the request before it reaches the function. The
`302` login redirect carries a signed `meta` JWT in its query string; decode its
payload (base64url) and read `service_token_status`:

- `service_token_status: false` **and** the service token shows **"Not seen yet"**
  in Zero Trust → Access → Service credentials → the request is not matching the
  token at all. The most common cause is that the
  `CF-Access-Client-Id` / `CF-Access-Client-Secret` **value contains the header
  name too** — e.g. a GitHub secret set to `CF-Access-Client-Id: fbfe…access`
  instead of just `fbfe…access`. Because the workflow interpolates the secret
  into `--header "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}"`, the header name
  ends up doubled and the transmitted ID matches no token. Store **only the
  value** in each secret. Rotating the token does not fix this — the secret value
  was never the problem.
- `service_token_status: true` but still `302` → the credentials are valid but no
  `Service Auth` policy grants them. Confirm the policy Action is literally
  `Service Auth` (not `Allow` with a service-token include), and that it lives on
  the Access application whose destination matches `keloshell.pages.dev` (a bare
  host with no path). Note there are overlapping apps for `*.keloshell.pages.dev`
  and specific paths (`/manifest.json`, `/assets/icons/*`) — the wildcard does
  **not** match the apex host.

Once Access passes the request through, an HTTP `401`
(`A valid reminder dispatch token is required.`) means the service token works
and the function was reached — the request simply lacked the
`Authorization: Bearer <REMINDER_DISPATCH_TOKEN>` header (the workflow sends it;
a bare diagnostic `curl` does not). The workflow fails on any non-2xx response,
so a green run means the dispatcher returned JSON.
