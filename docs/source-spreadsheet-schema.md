# Source Spreadsheet schema

This document records the Source Spreadsheet structure used by the read-only
Training Week slice. The server adapter owns this mapping; browser code must
only use the domain contract from `src/contracts/training.ts`.

## Workout Session tabs

The four required tabs are `Upper A`, `Lower A`, `Upper B`, and `Lower B`.
Each tab is organized as repeating vertical program blocks:

1. A Program Definition begins on a row labeled `Lift`.
2. Fields between `Lift` and `Week` include `Progression`, `Sets`, `Reps`,
   optional `Prox. to Failure`, and `Cue`.
3. Each programmed lift occupies six columns: label/date, weight, and set
   result columns 1 through 4.
4. Rows below `Week`, up to the next `Lift` row, are existing Training Weeks.

The adapter discovers label rows and does not depend on fixed row numbers.
A programmed lift requires a name, a rep target, and a whole-number set count
from one through four. A Training Week is unavailable unless all four Workout
Sessions have at least one usable programmed lift for its program block.

## Training Week dates

The sheet displays session dates as month/day. Some January cells retain the
prior year in their underlying Google Sheets serial value. The adapter anchors
the first date to its stored year, follows the displayed row order, and
increments the year when month/day rolls backward across New Year.

All four Workout Session tabs must normalize to the same unique, ordered
sequence. Canonical `YYYY-MM-DD` dates are application identifiers; sheet row
and column coordinates never leave the server.

The displayed Training Week number is the one-based position in this ordered
sequence. Unavailable rows retain their number so later Program Definition
changes do not renumber existing weeks.

## Completion interpretation

A Complete Lift Log has a positive numeric weight and a non-negative
whole-number result for each programmed set. Any entered weight or set value
that does not satisfy those rules is partial. Completion is derived at read
time and is never written to the Source Spreadsheet.

Existing malformed values remain Source Spreadsheet data. This read slice uses
them only to derive partial status; future detail views must display them
faithfully rather than silently rewriting them.
