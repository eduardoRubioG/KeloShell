# Production connectivity setup

Use this when you are ready to cut KeloShell over from the replica spreadsheet to the real Source Spreadsheet.

This is not a second `.dev.vars` file. Local development uses `.dev.vars`; production uses Cloudflare Pages environment settings plus the non-secret values already checked into `wrangler.jsonc`.

## What stays in the repo

These values are versioned in [`wrangler.jsonc`](../wrangler.jsonc):

- `SHEETS_TARGET_LABEL`
- `CONNECTIVITY_SHEET_NAME`
- `CONNECTIVITY_SENTINEL`
- `ALLOW_CONNECTIVITY_WRITE_TEST`
- `REMINDER_TIME_ZONE`

For production, override these values:

- `SHEETS_TARGET_LABEL=source`
- `ALLOW_CONNECTIVITY_WRITE_TEST=false`

That keeps the `/api/connectivity-test` route read-only after cutover and makes the diagnostic output describe the Source Spreadsheet instead of the replica.

## What belongs in Cloudflare

Set these as production secrets or environment variables for the Pages project:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SPREADSHEET_ID`
- `KELOSHELL_META_DB_SHEET`
- `REMINDER_DISPATCH_TOKEN`
- `EMILY_GOOGLE_SPREADSHEET_ID`
- `EMILY_META_DB_SHEET`
- `EMILY_EMAIL`
- `EDUARDO_EMAIL` (optional — defaults to Eduardo's known Google address)

The service account email and private key stay the same as in replica testing. Only the spreadsheet ID changes at cutover. `KELOSHELL_META_DB_SHEET` points to the separate KeloShell meta database spreadsheet (not the Source Spreadsheet).

## Multiple users

KeloShell serves two people (Eduardo and Emily), each with their own coach training-source spreadsheet and their own meta DB. Requests are attributed to a user by the Cloudflare Access email:

- `resolveUserId` (in `functions/lib/users.ts`) matches the signed-in `Cf-Access-Authenticated-User-Email` against `EDUARDO_EMAIL` / `EMILY_EMAIL`, then serves that user's spreadsheets. The shared service account is granted Editor on all four spreadsheets; only the spreadsheet IDs differ.
- Push subscriptions and reminder-delivery records are namespaced per user in KV (`push:subscriptions:<id>`, `push:reminders:<id>:<date>`), so `/api/push/dispatch-reminders` reads each user's own sheets and subscriptions in one run.

To onboard Emily:

1. **Cloudflare Access:** add `EMILY_EMAIL` to the Access application's allow policy so she can reach the app.
2. **Google:** create her training-source spreadsheet and her meta DB, share both with `GOOGLE_SERVICE_ACCOUNT_EMAIL` as Editor, and seed her `_PWA_CONNECTIVITY`, `Habits`, and `Steps` tabs (same layout as Eduardo's, described below).
3. **Pages env:** set `EMILY_EMAIL`, `EMILY_GOOGLE_SPREADSHEET_ID`, `EMILY_META_DB_SHEET` (and `EDUARDO_EMAIL`), then redeploy — Pages Functions bake env values in at deploy time.
4. She opens the app and allows notifications so her push subscription registers under `push:subscriptions:emily`.

## Before cutover

Make sure the Source Spreadsheet is ready:

- The `_PWA_CONNECTIVITY` tab exists.
- Cell `A1` contains `KELOSHELL_CONNECTIVITY_V1`.
- Cell `B1` is blank.
- The Source Spreadsheet is shared with the service account email as an editor.

If any of those are missing, the production connectivity test will fail even if the Cloudflare settings are correct.

## Production values

Use the following values when you are ready to switch production over:

```text
SHEETS_TARGET_LABEL=source
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account-email-from-google-cloud>
GOOGLE_PRIVATE_KEY=<private-key-from-the-same-service-account-json>
GOOGLE_SPREADSHEET_ID=<eduardo-source-spreadsheet-id>
KELOSHELL_META_DB_SHEET=<eduardo-meta-db-spreadsheet-id>
EMILY_GOOGLE_SPREADSHEET_ID=<emily-source-spreadsheet-id>
EMILY_META_DB_SHEET=<emily-meta-db-spreadsheet-id>
EDUARDO_EMAIL=<eduardo-cloudflare-access-email>
EMILY_EMAIL=<emily-cloudflare-access-email>
ALLOW_CONNECTIVITY_WRITE_TEST=false
REMINDER_TIME_ZONE=America/New_York
REMINDER_DISPATCH_TOKEN=<same-random-token-as-the-GitHub-Actions-secret>
```

Before setting `KELOSHELL_META_DB_SHEET` in production:

- Create a `Habits` tab in that spreadsheet with header `Date | Habit` in `A1:B1`.
- Create a `Steps` tab in that spreadsheet with header `Date | Steps` in `A1:B1`.
- Share the spreadsheet with the service account email as an Editor.

Keep the private key exactly as exported from Google. If it contains escaped newlines (`\n`), preserve them.

## Cutover order

1. Confirm the Source Spreadsheet is prepared and shared with the service account.
2. Override `SHEETS_TARGET_LABEL` to `source` in production.
3. Update the production `GOOGLE_SPREADSHEET_ID` to the Source Spreadsheet ID.
4. Set `ALLOW_CONNECTIVITY_WRITE_TEST=false` in production.
5. Leave previews pointed at the replica until you deliberately change them.
6. Deploy production.
7. Hit `/api/connectivity-test` and verify the response shows Google authentication passing and the write test skipped.

## What not to set in production

- Do not set `LOCAL_AUTH_BYPASS`.
- Do not point production at the replica spreadsheet once cutover is complete.
- Do not enable the write test in production unless you are deliberately validating the temporary marker flow.
