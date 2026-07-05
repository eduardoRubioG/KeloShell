# keloshell-reminder-cron

A tiny, standalone Cloudflare Worker whose only job is to call the main app's
`POST /api/push/dispatch-reminders` endpoint on a schedule.

It exists because Cloudflare Pages Functions have no cron support, and
GitHub Actions' `schedule` event is best-effort with no timing guarantee — in
production it was observed landing 1-3 hours after every candidate cron
slot, which defeats the point of a 7am/9pm reminder. Cloudflare's own [Cron
Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
run a Worker at its scheduled UTC minute, so moving the scheduler here
(instead of the main Pages app) gets consistent delivery times while keeping
credentials inside Cloudflare rather than a third-party cron service.

This Worker does not read the spreadsheet, hold VAPID keys, or touch KV — all
of that logic still lives in the main app's dispatch endpoint. This Worker
only holds the credentials needed to call that endpoint.

## Deploy

From this directory:

```bash
npx wrangler deploy
```

## One-time secret setup

Set these with `wrangler secret put <NAME>` (run from this directory), using
the same values already configured for the `Scheduled reminders` GitHub
Actions workflow:

- `REMINDER_DISPATCH_URL` — the production URL ending in `/api/push/dispatch-reminders`
- `REMINDER_DISPATCH_TOKEN` — must match the `REMINDER_DISPATCH_TOKEN` Cloudflare Pages secret on the main app
- `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` — the Cloudflare Access service token allowed to reach the deployed Pages application

```bash
npx wrangler secret put REMINDER_DISPATCH_URL
npx wrangler secret put REMINDER_DISPATCH_TOKEN
npx wrangler secret put CF_ACCESS_CLIENT_ID
npx wrangler secret put CF_ACCESS_CLIENT_SECRET
```

## Schedule

Configured in `wrangler.jsonc`:

```
0 11 * * *   # 7am America/New_York during DST
0 12 * * *   # 7am America/New_York during standard time
0 1 * * *    # 9pm America/New_York during DST
0 2 * * *    # 9pm America/New_York during standard time
```

Two candidates per window cover the DST/standard-time shift — the dispatch
endpoint itself ignores whichever one lands outside its target local hour, so
firing both is harmless.

## Verifying

Check recent invocations and logs in the Cloudflare dashboard under
**Workers & Pages → keloshell-reminder-cron → Logs**, or tail live:

```bash
npx wrangler tail
```

A successful run logs `[reminder-cron] HTTP 200: {...}` with the same JSON
body the dispatch endpoint returns to GitHub Actions today (`sent`,
`reminders`, `skipped`, etc.). A non-2xx response throws, which triggers
Cloudflare's automatic Cron Trigger retry.
