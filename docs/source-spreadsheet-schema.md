# Source Spreadsheet schema

This document describes the Source Spreadsheet format the **Coach Partner**
Coach Template adapter discovers. It is the one adapter shipped today (see
`docs/adr/0004-coach-template-adapters.md`). Everything here is owned by that
adapter: services, API handlers, reminder code and browser code speak only
domain terms and the contracts in `src/contracts/`, never tab names, labels or
cells.

The spreadsheet is not a fixed set of tabs. Tabs are **discovered by
structure** from whatever the spreadsheet contains, so Workout Session names,
the number of Workout Sessions, the number of lifts and the number of Tracking
Tabs (typically one per year) can all change without a code change.

App-Owned Data (the steps and habit tabs the app writes itself) is outside this
format and is not covered here; the steps endpoints never read coach-authored
tabs.

## Workout Session signature

A tab is a Workout Session only when at least one Program Definition on it
carries the full signature: a `Lift` label row in column A, then `Progression`,
`Sets` and `Reps` rows between `Lift` and `Week`, then a `Week` header row. The
tab name is the Workout Session name, and tab order is Session Order. A tab
with no full Program Definition (notes, templates, archives, or a tab with only
partial `Lift` blocks) is ignored silently and produces no problem. Once a tab
qualifies, its other malformed Program Definitions still report
`missing-week-header` or `missing-program-field`.

Each Workout Session tab is organized as repeating vertical program blocks:

1. A Program Definition begins on a row labeled `Lift`.
2. Between `Lift` and the next `Week` row are field rows: `Progression`,
   `Sets` and `Reps` are required; `Prox. to Failure` and `Cue` are optional.
   The `Week` row must appear within ten rows of `Lift`.
3. Each programmed lift occupies a six-column group: label/date, weight, and
   set result columns 1 through 4. A lift's name is on the `Lift` row in the
   group's second column.
4. Rows below `Week`, up to the next `Lift` row, are existing Training Weeks.
   The first cell of each row is its date.

Row numbers are never fixed; the adapter finds label rows. A programmed lift
needs a name, a Rep Target and a whole-number set count from one through four
(a range such as `2-3` is allowed). A lift that fails those rules is skipped
and reported as a non-blocking problem; the remaining lifts still work.

### Training Week dates

The sheet displays Training Week dates as month/day. Some January cells keep
the prior year in their stored serial value. The adapter anchors the first
date to its stored year, follows row order, and adds a year whenever the
month/day rolls backward (for example `Dec 29` followed by `Jan 5`). Canonical
`YYYY-MM-DD` dates are the application's identifiers; rows and columns never
leave the server.

All Workout Session tabs must produce the same unique, ordered date sequence.
The displayed Training Week number is the one-based position in that sequence.
A Training Week where some lift is unusable is shown as unavailable and keeps
its number.

## Tracking Tab signature

A tab is a Tracking Tab when it has both:

- a header row whose first two cells are `Date` and `Weight` (Daily Bodyweight
  dates and values below it, columns A:B), and
- a `Month` header in column G (the Measurement Check-In section, which may sit
  on a different row from the `Date`/`Weight` header). Measurement Fields are
  the headers to the right of `Month`.

Tab names do not matter, so `Tracking '26`, `Tracking '27` and any later year
are found without configuration. Daily Bodyweight and Measurement Check-Ins
share this one definition.

Daily Bodyweight and Measurement Check-In history is merged across every
Tracking Tab in date order.

### Current Tracking Tab

The current Tracking Tab is the one whose Date column holds today's Local
Calendar Date, not the one with the newest name. Bodyweight and Measurement
Reminders look only at that tab. Problems confined to older Tracking Tabs (for
example an old year missing Measurement Fields) do not stop today's reminders.
If no Tracking Tab holds today, there is simply nothing due; that is not a
problem. If today appears in more than one Tracking Tab, the current tab is
ambiguous and the reminders are skipped (see `duplicate-tracking-date`).

Steps and creatine reminders do not depend on Tracking Tabs and still go out
when a Tracking Tab has a problem.

### Measurement Check-In dates and the year change

Measurement Check-In labels in column G are yearless (`July 1st`; a Google
Sheets date serial is also accepted). The year comes from the tab: the first
date in the tab's Date column anchors the year of the first label, and the year
increments whenever the label's month/day goes backward in row order. The
adapter reads Check-Ins from each Tracking Tab with that tab's own year, so a
December check-in in one tab and a January check-in in the next land in the
right years. A tab with Check-In labels but no dates in its Date column cannot
be anchored (`unanchored-measurement-year`).

### Writes and past dates

Daily Bodyweight and Measurement Check-In writes address a date, never a cell.
The adapter finds the date in whichever Tracking Tab holds it, so editing a
past date from a previous year writes to that year's tab, not the current one.
Before writing, the revision sent by the PWA must still match the sheet (stale
revisions are rejected as conflicts), a date missing from the sheet is a
conflict, and a date that appears in more than one Tracking Tab is refused as a
problem. Writes are confirmed by reading the value back.

## Completion interpretation

A Complete Lift Log has a positive numeric weight and a non-negative
whole-number result for each programmed set. Any entered weight or set value
that does not satisfy those rules is partial. Completion is derived at read
time and is never written to the Source Spreadsheet.

Existing malformed values remain Source Spreadsheet data. The PWA shows them
without silently rewriting them. The adapter uses unformatted values for
completion validation and formatted values for display so date-formatted rep
ranges and other formatting stay readable.

## Lift Log writes

The browser identifies a lift with a server-generated semantic ID and revision.
Before a write, the adapter re-reads the current Program Definition and rejects
stale revisions rather than overwriting coach-side changes. A save writes the
selected lift's weight and four result cells in one range; only programmed set
results may contain values and unused result cells are blanked. A clear removes
all five cells. Both are followed by a full read, and success is reported only
when the resulting Lift Log is confirmed from the Source Spreadsheet. A write
is refused when the Training section has blocking problems.

## Error contract

The adapter only reports problems. The services own the contract:

- When the section an endpoint needs has blocking problems, the endpoint
  returns **422** with:

  ```json
  {
    "error": "Your coach's spreadsheet needs a fix.",
    "problems": [
      { "code": "no-week-rows", "tab": "Upper A", "cell": null, "message": "..." }
    ]
  }
  ```

  `error` is the plain message the PWA shows the Subscriber in the feature's
  existing error state. `problems` is for the operator: a rule `code`, the
  `tab`, the A1 `cell` (or range) and a message. `tab` is null for
  whole-spreadsheet problems and `cell` is null when the problem is about a
  whole tab.
- Problems are logged with their codes by the services.
- Non-format failures (Google Sheets unreachable, permission errors) stay
  **502** and carry no `problems`.
- Problems in the other section never affect a response. A broken Tracking
  Tab leaves Training working, and broken Workout Session tabs leave Daily
  Bodyweight and Measurement Check-Ins working.

| Endpoint | Needs |
| --- | --- |
| `training-weeks`, `lift-log` | Training (Workout Sessions) |
| `bodyweight`, `daily-bodyweight`, `measurements`, `measurement-check-in` | Tracking (Tracking Tabs) |
| `streaks`, `creatine-log` | Both; 422 if either section is broken |
| `steps`, `daily-steps` | Neither (App-Owned Data) |

A missing Tracking Tab is a 422 (`no-tracking-tabs`), not an empty result, so
the Body page can tell it apart from a spreadsheet that has a Tracking Tab with
no rows yet.

### Partial results

Some problems leave a usable result. These are logged and returned alongside a
200, not a 422: a Daily Bodyweight date duplicated across Tracking Tabs on a
read (that date is left out), a Measurement Check-In duplicated across tabs
(only the first is listed), a Tracking Tab that has no Measurement Fields or
cannot be anchored while another Tracking Tab works, and lift-definition
problems that leave other lifts usable. A write that touches such a problem is
refused with a 422.

## Problem codes

| Code | Section | Meaning | Blocks |
| --- | --- | --- | --- |
| `unreadable-tabs` | Training | Google Sheets returned a different number of tab grids than requested, so Workout Sessions could not be read. Usually transient. | Yes |
| `no-workout-sessions` | Training | No tab has a Program Definition with the full Workout Session signature. | Yes |
| `missing-week-header` | Training | A Program Definition's `Lift` row has no `Week` header row within ten rows below it, on a tab that has at least one full Program Definition. A tab with only partial blocks is ignored, not reported. | Yes |
| `missing-program-field` | Training | A Program Definition on a qualifying tab lacks a required `Progression`, `Sets` or `Reps` row. One problem per missing field. Not reported for tabs that are ignored. | Yes |
| `unreadable-week-date` | Training | A Training Week row has content but no readable date in its first cell. | Yes |
| `invalid-week-date` | Training | A Training Week date is not a month/day value, not a real calendar date, or the first date has no usable year. | Yes |
| `duplicate-week-date` | Training | A Workout Session tab has the same Training Week date more than once. | Yes |
| `no-week-rows` | Training | A Workout Session tab has no Training Week rows. | Yes |
| `week-dates-mismatch` | Training | A Workout Session tab's Training Week dates differ from the first Workout Session's; every tab must line up. | Yes |
| `lift-missing-name` | Training | A lift column has Sets or Reps but no name. That lift is skipped. | No |
| `lift-missing-rep-target` | Training | A named lift has no Rep Target. That lift is skipped. | No |
| `set-count-out-of-range` | Training | A named lift's Sets is missing or outside one through four. That lift is skipped. | No |
| `no-tracking-tabs` | Tracking | No tab matches the Tracking Tab signature. | Yes |
| `duplicate-tracking-date` | Tracking | A Daily Bodyweight date appears in more than one Tracking Tab. | On write; on read the date is left out |
| `duplicate-measurement-date` | Tracking | A Measurement Check-In date appears in more than one Tracking Tab. | On write; on read only the first is listed |
| `missing-measurement-fields` | Tracking | A Tracking Tab has no Measurement Fields next to its `Month` header. | Only when no Tracking Tab yields Measurement Fields |
| `unanchored-measurement-year` | Tracking | A Tracking Tab has Check-In labels but no dates in its Date column, so their year is unknown. | Only when no Tracking Tab yields Measurement Fields |

"Blocks" means the section's endpoints return 422. A Training problem that does
not block still appears in logs; the affected lift is simply not offered.

## Dev and operator notes

Problem codes and messages appear in API responses and in Cloudflare logs under
`source spreadsheet problems`. Reminder dispatch uses the same services, so it
logs the same codes.
