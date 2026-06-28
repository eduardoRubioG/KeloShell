# ADR-0001: Host the PWA and spreadsheet proxy on Cloudflare

## Status

Accepted

## Context

KeloShell must remain an installable PWA while privately reading and writing one Source Spreadsheet. A separately hosted PWA calling Apps Script would leave cross-origin access, authentication, and PWA hosting constraints unresolved. Browser-owned Google Sheets credentials would also couple the UI directly to spreadsheet coordinates and OAuth token management.

## Decision

Cloudflare Pages hosts the static PWA and same-repository Pages Functions. Cloudflare Access provides Eduardo-only Private Tool Access. A Pages Function authenticates to Google with a service account shared onto the spreadsheet and exposes application-owned API operations to the PWA.

All environments initially target a replica. Local development uses a localhost-only authentication bypass; deployed environments require Cloudflare Access. Production cutover to the Source Spreadsheet is a separate decision and configuration change.

## Consequences

- Google credentials and spreadsheet coordinates remain outside browser code.
- PWA and API deploy from one repository and use same-origin requests.
- Cloudflare Access configuration is required before deployed connectivity can work.
- The Worker runtime and free-plan CPU limit must be validated with the real Google round trip.
- Apps Script is not part of the selected architecture.

