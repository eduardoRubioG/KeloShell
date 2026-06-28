# KeloShell

KeloShell is Eduardo's private workout logging companion for a coach-managed Google spreadsheet. The Lit PWA and its Cloudflare Pages Function live in this repository and deploy together.

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

## Commands

```bash
npm run dev       # build and run the complete Pages app locally
npm run dev:ui    # Vite UI only
npm test          # unit and failure-path tests
npm run build     # frontend and Worker typechecks, then production build
npm run deploy    # build and deploy with Wrangler
```

## Production cutover

Cutover is intentionally out of scope for the connectivity proof. When you are ready, follow [`docs/production-vars.md`](docs/production-vars.md) for the exact production secret and variable setup.
