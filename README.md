# KeloShell

KeloShell is Eduardo's private workout logging companion for a coach-managed Google spreadsheet. The React PWA and its Cloudflare Pages Function live in this repository and deploy together.

## Connectivity architecture

```text
PWA -> same-origin /api request -> Cloudflare Pages Function -> Google Sheets API
```

Cloudflare Access protects the deployed app. The Pages Function holds the Google service-account credentials and exposes only application-owned operations; credentials never reach browser code.

The current implementation is a connectivity proof. Every environment targets a replica of the Source Spreadsheet until a separate production cutover.

## Prepare the replica

1. Make a copy of the real Source Spreadsheet.
2. Add a tab named `_PWA_CONNECTIVITY`.
3. Put `KELOSHELL_CONNECTIVITY_V1` in cell `A1`.
4. Leave cell `B1` blank. It is reserved for the temporary connectivity marker.
5. In a Google Cloud project, enable the Google Sheets API and create a service account with a JSON key.
6. Share the replica with the service account's email address as an editor.

The function requests only the `spreadsheets` OAuth scope. It does not need Drive API access.

## Local development

Install dependencies and prepare local secrets:

```bash
npm install
cp .dev.vars.example .dev.vars
```

Fill in these values in `.dev.vars`:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SPREADSHEET_ID` — use the replica ID
- `LOCAL_AUTH_BYPASS=true` — accepted only on `localhost` or `127.0.0.1`

Run the full Pages application:

```bash
npm run dev
```

Wrangler serves the built PWA and Pages Function together. Use `npm run dev:ui` only for frontend-only work; API calls will not be available in that mode.

## Cloudflare setup

1. Create a Cloudflare Pages project connected to this repository.
2. Set the build command to `npm run build` and output directory to `dist`.
3. Make an initial deployment.
4. In Cloudflare Zero Trust, create an Access self-hosted application covering the production Pages hostname and preview hostnames.
5. Enable the one-time PIN login method and add an Allow policy for Eduardo's exact email address.
6. Add the three Google values above as encrypted secrets for both preview and production. Both must use the replica spreadsheet ID during this phase.
7. Confirm requests reaching `/api/connectivity-test` contain Cloudflare's `Cf-Access-Jwt-Assertion` header.

Non-secret connectivity settings are versioned in `wrangler.jsonc`. Do not add `LOCAL_AUTH_BYPASS` to any deployed environment.

## Scheduled reminders

The dispatch endpoint (`POST /api/push/dispatch-reminders`) evaluates several
reminder kinds, each due no earlier than its own local time in
`America/New_York`:

- Bodyweight Reminder and Measurement Reminder — 7am, read from the Source Spreadsheet
- Steps Reminder (morning) — 7:30am, due when yesterday has no value in the
  `Steps` sheet of the KeloShell meta database spreadsheet
- Creatine Reminder — 9pm, due when today has no `creatine` row in the Habits
  sheet of the KeloShell meta database spreadsheet
- Steps Reminder (evening) — 10pm, due when today has no value in the `Steps`
  sheet of the KeloShell meta database spreadsheet

It stores successful delivery kinds in KV by Local Calendar Date, so it is
safe to call more than once per day — later calls just no-op for kinds
already delivered.

**Scheduler: `workers/reminder-cron`.** Recurring dispatch is driven by a
small, separate Cloudflare Worker with a real [Cron
Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
not GitHub Actions. Cloudflare runs a scheduled Worker at its scheduled UTC
minute; GitHub Actions' `schedule` event is explicitly best-effort and was
observed here landing 1-3 hours late (sometimes coalescing to a single run
for the whole day), which defeats the point of a 7am/9pm reminder. See
[`workers/reminder-cron/README.md`](workers/reminder-cron/README.md) for
deploy and secret setup.

The `.github/workflows/reminders.yml` workflow still exists but only runs via
manual `workflow_dispatch` (with `force` to bypass the local-time windows) —
useful for testing the dispatch endpoint without waiting for a cron tick. It
needs the same repository secrets as before: `REMINDER_DISPATCH_URL`,
`REMINDER_DISPATCH_TOKEN`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`.

Configure these Cloudflare Pages secrets (for the main app):

- `REMINDER_DISPATCH_TOKEN` — a long random bearer token shared with the reminder-cron Worker
- the existing Google, VAPID, `PUSH_KV`, and `KELOSHELL_META_DB_SHEET` bindings used by the app

## Commands

```bash
npm run dev       # build and run the complete Pages app locally
npm run dev:ui    # Vite UI only
npm run dev:host  # expose the Vite UI on your local network for phone testing
npm test          # unit and failure-path tests
npm run test:isolation  # Supabase isolation suite (needs npx supabase start)
npm run build     # frontend and Worker typechecks, then production build
npm run deploy    # build and deploy with Wrangler
```

To open the UI on a phone connected to the same network, run
`npm run dev:host` and use the Network URL printed by Vite. This serves only the
frontend: `/api/*` requests are unavailable, and the PWA features that require a
secure context may require HTTPS.

The IDE launch task and `npm run start-remote` also run the complete Pages app
on port 5173. Use `npm run dev:ui` only when API calls are intentionally out of
scope; Vite alone cannot execute files in `functions/`.

## CI

`.github/workflows/ci.yml` runs the `build-and-test` job on every pull request
to `main` and every push to `main`: `npm ci`, `npm run build`, a type-check of
the reminder cron Worker (`npx tsc -p workers/reminder-cron/tsconfig.json`), and
`npm test`. The job is read-only and uses no secrets. `main` is protected: the
`build-and-test` check must pass and changes go through a pull request. CI does
not deploy; production still deploys by hand from `main`.

## Supabase local stack and isolation suite

App-Owned Data is moving into Supabase Postgres with row-level security. The
Supabase project in `supabase/` runs only on the local stack: there is no
`supabase link` and no remote project ref. The pinned `supabase` CLI is a dev
dependency, so use it through `npx`. Docker must be running.

```bash
npx supabase start          # start the local stack and apply supabase/migrations/
npm run test:isolation      # run the isolation suite against it
npx supabase db reset       # rebuild the database from migrations alone
npx supabase stop           # stop the stack when you're done
```

The isolation suite in `supabase/tests/` proves through supabase-js, with each
fake user's token, that one Subscriber can't read or change another
Subscriber's rows. Its global setup reads the stack's URL and keys from
`npx supabase status -o env`, refuses to run unless the URL's host is
`127.0.0.1` or `localhost`, and finds or creates the fake users
(`x@test.local`, `y@test.local`, `inactive@test.local` and
`outsider@test.local`). It's safe to re-run without a reset. `npm test` never
includes it, so `npm test` and `build-and-test` don't need Docker.

The schema, its RLS policies and the reasons behind them are documented in
[`docs/database.md`](docs/database.md).

## Database migrations and the isolation check

Migrations in `supabase/migrations/` are plain SQL and **additive only**: each
one adds tables, columns, functions, policies or wider checks. Never edit a
migration that has merged, and never drop, rename or narrow anything in the same
change that stops using it; destructive changes ship in a later, separate
migration once nothing depends on the old shape.

The `isolation` job in `.github/workflows/ci.yml` runs on every pull request to
`main` and every push to `main`, in parallel with `build-and-test`. It starts a
pared-down local stack, runs `npx supabase db reset`, runs
`npm run test:isolation`, and always stops the stack. It uses no secrets. The
`isolation` check is required on `main` alongside `build-and-test`; a change to
the schema or its policies merges only when it passes.

## Frontend structure

The frontend uses React, file-based TanStack Router routes, and TanStack Query for same-origin API state. Route files stay thin and delegate UI and domain behavior to feature folders.

```text
src/
├── app/       # React bootstrap, router, Query client, development tools
├── routes/    # File-based route declarations
├── features/  # Training, body tracking, and history features
├── shared/    # Cross-feature layout and UI
├── contracts/ # Browser/Worker API contracts
└── styles/    # Global Tailwind theme and base styles
```

The generated `src/routeTree.gen.ts` file is committed so TypeScript can validate a clean checkout before Vite runs. Do not edit it directly; the TanStack Router Vite plugin owns it.

### Design reference

Treat [`designs/001__app_designs.html`](designs/001__app_designs.html) as the
first-class reference for the PWA's visual language and general structure. It
is directional rather than a complete behavioral specification: preserve its
typography, color, spacing, progress treatments, mobile hierarchy, and
navigation patterns while adapting incomplete screens to `CONTEXT.md`, real
Source Spreadsheet data, accessibility, and responsive behavior.

The server-owned spreadsheet mapping is documented in
[`docs/source-spreadsheet-schema.md`](docs/source-spreadsheet-schema.md).

## Production cutover

Cutover is intentionally out of scope for the connectivity proof. When you are ready, follow [`docs/production-vars.md`](docs/production-vars.md) for the exact production secret and variable setup.
