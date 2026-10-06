# ADR-0004: Orchestrate Source Spreadsheets through Coach Template adapters

## Status

Accepted 2026-10-06. Refines ADR-0003; does not reverse it.

## Context

ADR-0003 keeps multi-coach support and coach-specific runtime configuration outside the pilot, and #7 defines the Supported Spreadsheet Format as the single Coach Partner's template, discovered by structure. KeloShell is still expected to add partner coaches later, and each will bring a different sheet template, layout, and validation rules. If template-specific knowledge (tab signatures, label rows, column layout, problem rules) spreads through API handlers, reminders, and validation, every new coach would need changes across the codebase.

## Decision

Split Source Spreadsheet handling into three layers:

- **Spreadsheet gateway:** raw Google Sheets I/O (list tabs, read ranges, write and clear ranges). This layer is shared by every coach.
- **Coach Template adapter:** one isolated bundle per **Coach Template** containing all template-specific logic: discovery, parsing, validation, and mapping domain writes to cells. Its interface speaks only domain terms (Workout Sessions, Training Weeks, Lift Logs, Daily Bodyweight, Measurement Check-Ins, structured problems), never rows or columns.
- **Template-agnostic services:** Training, Body, Reminders, and Validation. API handlers, reminder dispatch, and operator scripts call only these services, which depend only on the adapter interface.

A registry resolves a Subscriber's Coach Template adapter. The pilot ships with exactly one adapter, the Coach Partner's template, and every Subscriber resolves to it. When Subscriber records move to Postgres, the Coach Template becomes a field on the Subscriber row.

## Consequences

- Adding a partner coach means adding an adapter and a registry entry, with no change to services, the API, or the PWA.
- With one adapter, the interface is a hypothetical seam: the second Coach Template will test its shape. Keep it narrow and in domain terms, and do not add speculative configuration options before a second coach exists.
- No service, API handler, or reminder code may refer to template-specific tab names, labels, or cell layout.
- Structured problem codes are produced by adapters but surfaced by the Validation service, so Sheet Health, coach emails, and the PWA stay template-agnostic.
- Progression guidance currently runs in the PWA and is not covered by this decision. Making Supported Progression Schemes pluggable per coach is separate work.
- Multi-coach enrolment, coach selection at signup, and per-coach billing remain outside the pilot, as ADR-0003 states.
