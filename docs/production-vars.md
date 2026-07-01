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
- `REMINDER_DISPATCH_TOKEN`

The service account email and private key stay the same as in replica testing. Only the spreadsheet ID changes at cutover.

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
GOOGLE_SPREADSHEET_ID=<source-spreadsheet-id>
ALLOW_CONNECTIVITY_WRITE_TEST=false
REMINDER_TIME_ZONE=America/New_York
REMINDER_DISPATCH_TOKEN=<same-random-token-as-the-GitHub-Actions-secret>
```

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
