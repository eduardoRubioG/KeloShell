# Bodybuilding Coach PWA

This context describes a mobile workout logging companion that presents a gym-friendly UI over Eduardo's coach-managed bodybuilding spreadsheet.

## Language

**Source Spreadsheet**:
The coach-managed Google Sheets file that contains the bodybuilding program and is the source of truth for workout and bodyweight data.
_Avoid_: database, backend database

**PWA**:
The mobile-first interface Eduardo uses to read from and write to the **Source Spreadsheet**.
_Avoid_: coaching app, training engine

**Workout Logging Companion**:
A tool for capturing bodyweight and completed workout set data without making training decisions.
_Avoid_: coach, program generator, progression engine

**Training Week**:
The weekly unit of the program, identified by an existing week-start row in the **Source Spreadsheet**, in which Eduardo is expected to complete all four programmed workout sessions.
_Avoid_: cycle, block

**Workout Session**:
One of the four programmed sessions that belong to a **Training Week**: Upper A, Lower A, Upper B, or Lower B.
_Avoid_: workout, gym visit

**Session Order**:
The advisory order of **Workout Sessions** within a **Training Week**: Upper A, Lower A, Upper B, Lower B.
_Avoid_: required rotation, schedule

**Complete Session**:
A **Workout Session** with logged data for every programmed lift in that session for the selected **Training Week**.
_Avoid_: done

**Partial Session**:
A **Workout Session** with logged data for at least one, but not every, programmed lift in that session for the selected **Training Week**.
_Avoid_: incomplete, draft

**Not Started Session**:
A **Workout Session** with no logged lift data for the selected **Training Week**.
_Avoid_: empty workout

**Complete Training Week**:
A **Training Week** whose four **Workout Sessions** are all **Complete Sessions**.
_Avoid_: finished week

**Partial Training Week**:
A **Training Week** with at least one logged **Workout Session** but fewer than four **Complete Sessions**.
_Avoid_: incomplete week

**Not Started Training Week**:
A **Training Week** whose four **Workout Sessions** are all **Not Started Sessions**.
_Avoid_: empty week

**Lift Log**:
Eduardo's recorded weight and set results for a programmed lift in a specific **Training Week**.
_Avoid_: exercise record

**Lift Weight**:
The single positive decimal working weight used for all sets of a programmed lift in a **Lift Log**, expressed in the **Source Spreadsheet**'s implicit unit.
_Avoid_: set weight, per-set weight

**Set Result**:
The actual whole-number rep count Eduardo completed for one set of a programmed lift.
_Avoid_: target reps, score

**Complete Lift Log**:
A **Lift Log** with a weight and set results entered for the lift's programmed number of sets.
_Avoid_: passed, successful

**Partial Lift Log**:
A **Lift Log** with some, but not all, required weight and set result data for the lift's programmed number of sets.
_Avoid_: failed

**Edit**:
A replacement of existing **Source Spreadsheet** values for a selected **Training Week**, **Workout Session**, or **Lift Log**.
_Avoid_: revision, correction event, audit entry

**Clear**:
An explicit **Edit** that removes existing values from a **Lift Log** or **Daily Bodyweight**.
_Avoid_: untouched, skipped

**Program Definition**:
The coach-authored lift names, progression schemes, set counts, rep ranges, cue text, and other training instructions in the **Source Spreadsheet**.
_Avoid_: user settings, editable workout

**Execution Context**:
Read-only coach-authored information needed to perform a programmed lift, including lift name, progression scheme, set count, rep target, proximity to failure, and cue text.
_Avoid_: help text, app instructions

**Coach Notes**:
Coach-authored profile, priority, rotation, or coaching context stored in the **Source Spreadsheet**.
_Avoid_: app notes, user notes

**Free-Form Notes**:
Eduardo-authored lift, session, or body tracking comments.
_Avoid_: comments, annotations

**Exercise Substitution**:
Performing or recording a different lift than the coach-authored programmed lift.
_Avoid_: swap, replacement lift

**Gym Utility**:
A non-spreadsheet tool such as a rest timer, plate calculator, or workout aid.
_Avoid_: timer, calculator

**Synced Entry**:
An entry that has been written to and confirmed by the **Source Spreadsheet**.
_Avoid_: local entry, draft entry

**Eduardo**:
The single client whose bodybuilding program is managed in the **Source Spreadsheet**.
_Avoid_: user, account, client list

**Private Tool Access**:
Access to the **PWA** and its writes governed by Cloudflare Access and the private **Source Spreadsheet** rather than app-specific accounts.
_Avoid_: app login, user account

**Progression Prompt**:
An advisory message derived from the coach-authored progression scheme indicating that a lift appears eligible for a future weight increase.
_Avoid_: progression automation, prescription, coaching decision

**Next-Weight Recommendation**:
An advisory **Lift Weight** calculated from a triggered **Progression Prompt**.
_Avoid_: planned weight, required weight

**Supported Progression Scheme**:
A coach-authored progression scheme format the **PWA** explicitly knows how to evaluate.
_Avoid_: free-text inference, guessed rule

**Dynamic DP**:
A **Supported Progression Scheme** that prompts progression when the first **Set Result** is greater than or equal to the **Rep Range Maximum**.
_Avoid_: guessed double progression

**Standard DP**:
A **Supported Progression Scheme** that prompts progression when every programmed **Set Result** is greater than or equal to the **Rep Range Maximum**.
_Avoid_: guessed double progression

**All Set Rep Floor**:
A **Supported Progression Scheme** that prompts progression when every programmed **Set Result** is greater than or equal to the **Rep Floor**.
_Avoid_: minimum reps

**Top/Backoff**:
A **Supported Progression Scheme** that prompts progression when the first **Set Result** is greater than or equal to the **Rep Floor** and every remaining programmed **Set Result** is greater than or equal to the **Rep Range Maximum**.
_Avoid_: top set only

**Five-Five-Three-AMRAP**:
A **Supported Progression Scheme** that prompts progression when the final programmed **Set Result** reaches at least three reps.
_Avoid_: 5/5/3 free text

**RM Calculator**:
A coach-authored calculator used to adjust estimated one-rep max values for **Five-Five-Three-AMRAP** progression.
_Avoid_: app calculator, generic weight recommendation

**Volume Ramp**:
A **Supported Progression Scheme** that prompts progression when all sets for the full ramp phase meet prescribed reps, provided the **Source Spreadsheet** identifies the full ramp phase.
_Avoid_: volume phase

**Intensity Ramp**:
A **Supported Progression Scheme** that prompts progression when all sets for the full ramp phase meet prescribed reps, provided the **Source Spreadsheet** identifies the full ramp phase.
_Avoid_: intensity phase

**Static Rep Linear**:
A **Supported Progression Scheme** that prompts progression when every programmed **Set Result** is greater than or equal to the prescribed rep count, interpreted as the **Rep Floor** when needed.
_Avoid_: linear progression

**Block Volume**:
A **Supported Progression Scheme** that prompts progression for the next block when all sets meet the sheet-defined block volume requirement.
_Avoid_: volume block

**Block Intensity**:
A **Supported Progression Scheme** that prompts progression when every programmed **Set Result** is greater than or equal to the prescribed rep count, interpreted as the **Rep Floor** when needed.
_Avoid_: intensity block

**Autoregulation**:
A **Supported Progression Scheme** that prompts progression every block when the **Source Spreadsheet** identifies the relevant block timing.
_Avoid_: automatic coaching

**Rep Target**:
The coach-authored rep instruction for a programmed lift, interpreted as a rep floor and, when present, a rep range maximum.
_Avoid_: rep result

**Rep Floor**:
The minimum rep count implied by a **Rep Target**.
_Avoid_: range max

**Rep Range Maximum**:
The high end of a bounded **Rep Target**.
_Avoid_: rep floor, open-ended target

**Previous Lift Log**:
The nearest earlier nonblank **Lift Log** for the same **Workout Session** and **Lift Identity**.
_Avoid_: last week, prior row

**Lift Identity**:
The app's interpretation that differently formatted or slightly renamed lift names refer to the same programmed lift.
_Avoid_: exercise block, column position

**Daily Bodyweight**:
Eduardo's bodyweight measurement for a specific calendar date.
_Avoid_: weigh-in

**Body Measurement**:
Eduardo's positive decimal physique measurement for a specific body part on a specific calendar date, expressed in the **Source Spreadsheet**'s implicit unit.
_Avoid_: body stat, measurement stat

**Measurement Check-In**:
A scheduled set of **Body Measurements** Eduardo records for coach review.
_Avoid_: progress update, physique entry

**Measurement Field**:
A coach-defined body part or physique metric tracked in the **Source Spreadsheet** for **Measurement Check-Ins**.
_Avoid_: measurement setting, app field

**Measurement Reminder**:
A prompt to enter a **Measurement Check-In** when an existing spreadsheet date matches the current calendar date.
_Avoid_: generated check-in, obligation, overdue check-in

**Local Calendar Date**:
The date according to Eduardo's local timezone.
_Avoid_: UTC date, server date

**Bodyweight Reminder**:
A prompt to enter **Daily Bodyweight** when an existing spreadsheet date matches the current calendar date and has no recorded value.
_Avoid_: required weigh-in, obligation

**Complete Measurement Check-In**:
A **Measurement Check-In** with values for every current **Measurement Field**.
_Avoid_: done check-in

**Partial Measurement Check-In**:
A **Measurement Check-In** with at least one, but not every, current **Measurement Field** value.
_Avoid_: incomplete check-in

## Relationships

- The **PWA** reads from and writes to exactly one **Source Spreadsheet**
- The **Source Spreadsheet** remains authoritative over the training program and logged data
- The **Workout Logging Companion** captures data but does not prescribe substitutions, progression changes, or readiness decisions
- Current **Source Spreadsheet** structure wins over stale **PWA** state
- A **Training Week** contains exactly four **Workout Sessions**
- A **Workout Session** belongs to exactly one **Training Week**
- A **Complete Session** has entries for every programmed lift; a **Partial Session** has entries for only some programmed lifts
- A **Not Started Session** has no logged lift data
- **Training Week** status is derived from the statuses of its four **Workout Sessions**
- **Training Week** status does not depend on **Daily Bodyweight** or **Measurement Check-Ins**
- The **Source Spreadsheet** defines which **Training Weeks** exist
- **Lift Logs** can be entered or edited for any existing **Training Week**
- The **PWA** does not create new **Training Weeks**
- A **Workout Session** is **Complete** when every programmed lift has a **Complete Lift Log** for the selected **Training Week**
- A **Workout Session** is **Partial** when at least one programmed lift has a **Partial Lift Log** or only some lifts have **Complete Lift Logs**
- Lift and session completion are UI interpretations of **Source Spreadsheet** values, not separate data written back to the sheet
- The **PWA** should require a weight and the programmed number of set results before submitting a **Complete Lift Log**
- A **Lift Log** has exactly one **Lift Weight**, shared across all sets for that programmed lift
- An **Edit** overwrites the current **Source Spreadsheet** values rather than creating a separate history record
- The **PWA** can write **Lift Logs**, **Daily Bodyweight**, and **Body Measurements**
- The **PWA** can read but must not write the **Program Definition** or **Coach Notes**
- The **PWA** should display **Execution Context** for programmed lifts
- There is at most one **Daily Bodyweight** per calendar date
- Re-entering **Daily Bodyweight** for the same date replaces the existing value
- A **Measurement Check-In** contains one or more **Body Measurements**
- **Measurement Fields** are defined by the **Source Spreadsheet**
- The **PWA** can remind Eduardo to enter **Daily Bodyweight** and **Measurement Check-Ins**
- A **Measurement Reminder** is based on an existing **Source Spreadsheet** date and is not created by the **PWA**
- A **Bodyweight Reminder** is based on an existing **Source Spreadsheet** date and is not created by the **PWA**
- **Bodyweight Reminders** and **Measurement Reminders** use the **Local Calendar Date**
- **Daily Bodyweight** and **Measurement Check-Ins** can be entered or edited for existing **Source Spreadsheet** dates
- The **PWA** does not create arbitrary body tracking dates
- A **Complete Measurement Check-In** has values for every current **Measurement Field**
- A **Partial Measurement Check-In** has values for only some current **Measurement Fields**
- Saving a **Measurement Check-In** writes only entered or edited **Body Measurements** and leaves untouched **Measurement Fields** unchanged
- **Body Measurements** use the same implicit units as the **Source Spreadsheet** and are not converted by the **PWA**
- For the MVP, the **PWA** requires connectivity and only treats confirmed **Source Spreadsheet** writes as **Synced Entries**
- The MVP supports exactly one **Eduardo** and one **Source Spreadsheet**
- The **PWA** is Eduardo-facing; the coach works directly in the **Source Spreadsheet**
- The MVP has **Private Tool Access** rather than app-specific accounts
- The **PWA** and its same-origin spreadsheet proxy are deployed together on Cloudflare Pages
- The spreadsheet proxy accesses the **Source Spreadsheet** through a Google service account; Google credentials are never sent to the browser
- **Free-Form Notes** are out of MVP scope
- **Exercise Substitutions** are out of MVP scope
- **Gym Utilities** are out of MVP scope
- The **PWA** may show **Progression Prompts** derived from the **Program Definition**
- **Progression Prompts** are shown only for **Supported Progression Schemes**
- A **Progression Prompt** does not change the **Program Definition** or future **Lift Logs**
- A **Progression Prompt** requires a **Complete Lift Log**
- A **Progression Prompt** includes a numeric next-weight suggestion only when the **Program Definition** explicitly provides the increment
- The **PWA** shows no progression-related prompt when progression conditions are not met
- A **Progression Prompt** may show an approximate five percent next-weight recommendation when its progression condition is met, unless the **Program Definition** provides a more specific increment
- A **Next-Weight Recommendation** uses the current **Lift Weight** increased by five percent and rounded to the nearest five in the **Source Spreadsheet**'s implicit unit unless the **Program Definition** provides a more specific increment
- The MVP does not model the **RM Calculator**
- **Five-Five-Three-AMRAP** can show an eligibility **Progression Prompt** but does not use the generic five percent **Next-Weight Recommendation**
- **Volume Ramp** and **Intensity Ramp** do not show **Progression Prompts** unless the **Source Spreadsheet** provides enough phase context to evaluate them
- **Block Volume** does not show **Progression Prompts** unless the **Source Spreadsheet** provides the block volume requirement
- **Autoregulation** does not show **Progression Prompts** unless the **Source Spreadsheet** provides enough block timing context to evaluate it
- When a **Progression Prompt** cannot be evaluated, the **PWA** silently omits the prompt while still displaying the scheme as **Execution Context**
- **Progression Prompts** do not have saved accept or dismiss state
- The **PWA** may show the **Previous Lift Log** as context for entering a current **Lift Log**
- **Previous Lift Logs** are matched by **Lift Identity**, not only by spreadsheet block position
- **Lift Identity** must have a clear single match before the **PWA** shows a **Previous Lift Log**
- **Previous Lift Logs** are scoped to the same **Workout Session**
- The **PWA** displays existing **Source Spreadsheet** values even when they do not satisfy PWA entry rules
- The **PWA** enforces valid **Lift Logs** and **Daily Bodyweight** only when writing new values
- **Session Order** can guide suggestions but does not restrict which **Workout Session** Eduardo logs or edits
- For the MVP, lift and session completion are evaluated against the current **Program Definition**
- A **Set Result** records what happened and does not need to satisfy the programmed rep target
- **Lift Weight** uses the same implicit unit as the **Source Spreadsheet** and is not converted by the **PWA**
- Saving a **Workout Session** writes only entered or edited **Lift Logs** and leaves untouched programmed lifts unchanged
- A **Rep Target** can be exact reps, an open-ended floor such as `7+`, or a bounded range such as `7-10`
- An open-ended **Rep Target** such as `7+` has a **Rep Floor** but no **Rep Range Maximum**
- Progression schemes that require a **Rep Range Maximum** do not prompt from an open-ended **Rep Target** alone
- **Top/Backoff** requires a bounded **Rep Target** with a **Rep Range Maximum**
- A **Clear** is distinct from leaving a programmed lift untouched

## Example dialogue

> **Dev:** "Should the **PWA** suggest a replacement exercise if a machine is taken?"
> **Domain expert:** "No — the **Workout Logging Companion** is just a UI over the **Source Spreadsheet**. Coaching decisions stay outside the app."

> **Dev:** "Should the app start from today's next lift?"
> **Domain expert:** "No — it should show the **Training Week** and the status of all four **Workout Sessions** for that week."

> **Dev:** "If Eduardo opens the app on Monday, should the app create a new **Training Week** automatically?"
> **Domain expert:** "No — a **Training Week** exists when it has a week-start row in the **Source Spreadsheet**."

> **Dev:** "If a lift asks for three sets and Eduardo enters all three set results but no weight, should the app mark the lift complete?"
> **Domain expert:** "No — a **Complete Lift Log** needs both a weight and the programmed set results."

> **Dev:** "If Eduardo changes weight between sets, should the app store a different weight per set?"
> **Domain expert:** "No — the coach's sheet expects one **Lift Weight** for the programmed lift."

> **Dev:** "If last week's logged weight was wrong, should the **PWA** keep the old value as history?"
> **Domain expert:** "No — an **Edit** replaces the current value in the **Source Spreadsheet**."

> **Dev:** "Should Eduardo be able to change a lift's set count from the app?"
> **Domain expert:** "No — that is part of the **Program Definition**, which is coach-owned."

> **Dev:** "Should Eduardo be able to edit coaching notes from the app?"
> **Domain expert:** "No — **Coach Notes** are read-only context."

> **Dev:** "If Eduardo logs bodyweight twice on the same date, should the app create two entries?"
> **Domain expert:** "No — the second **Daily Bodyweight** replaces the first for that date."

> **Dev:** "Should the app only capture bodyweight?"
> **Domain expert:** "No — the app should also support **Measurement Check-Ins** for coach review."

> **Dev:** "If the coach adds a thigh measurement column, should the app need a code change?"
> **Domain expert:** "No — **Measurement Fields** come from the **Source Spreadsheet**."

> **Dev:** "Should the app create the next measurement check-in date?"
> **Domain expert:** "No — a **Measurement Reminder** exists when a date already in the **Source Spreadsheet** matches today."

> **Dev:** "Should the app treat bodyweight as a required obligation?"
> **Domain expert:** "No — it should show a **Bodyweight Reminder** when today's existing spreadsheet date has no value."

> **Dev:** "Should reminders use UTC?"
> **Domain expert:** "No — reminders use Eduardo's **Local Calendar Date**."

> **Dev:** "If Eduardo forgot yesterday's bodyweight, can he enter it today?"
> **Domain expert:** "Yes, if yesterday already exists as a date in the **Source Spreadsheet**."

> **Dev:** "If Eduardo enters only waist and chest on a measurement day, should the app reject the check-in?"
> **Domain expert:** "No — that is a **Partial Measurement Check-In** and can be saved."

> **Dev:** "Should the app convert inches to centimeters?"
> **Domain expert:** "No — **Body Measurements** use the **Source Spreadsheet**'s implicit units."

> **Dev:** "If Eduardo logs a workout without connectivity, is it considered logged?"
> **Domain expert:** "No — for the MVP, only a **Synced Entry** in the **Source Spreadsheet** counts."

> **Dev:** "Should the app let a coach switch between multiple clients?"
> **Domain expert:** "No — the MVP supports only **Eduardo** and his **Source Spreadsheet**."

> **Dev:** "Should the coach review logs inside the app?"
> **Domain expert:** "No — the coach reviews updates in the **Source Spreadsheet**."

> **Dev:** "Should Eduardo create an app account?"
> **Domain expert:** "No — the MVP uses **Private Tool Access**, not app accounts."

> **Dev:** "If logged results satisfy the coach's progression scheme, should the app increase next week's weight?"
> **Domain expert:** "No — the app may show a **Progression Prompt**, but it must not automatically change future values."

> **Dev:** "Should the app infer a progression rule from unfamiliar free text?"
> **Domain expert:** "No — unfamiliar progression text is display-only **Execution Context**."

> **Dev:** "Which progression schemes should the app evaluate?"
> **Domain expert:** "The app should evaluate the coach-defined **Supported Progression Schemes** from the spreadsheet."

> **Dev:** "Should one strong set trigger a progression prompt when the remaining programmed sets are blank?"
> **Domain expert:** "No — a **Progression Prompt** requires a **Complete Lift Log**."

> **Dev:** "Should the app guess whether to add five or ten pounds?"
> **Domain expert:** "No — a numeric suggestion is shown only when the **Program Definition** explicitly provides the increment."

> **Dev:** "When a supported progression condition is met, can the app show a five percent next-weight recommendation?"
> **Domain expert:** "Yes — as a recommendation, not an automatic change, unless the **Program Definition** provides a more specific increment."

> **Dev:** "Should a five percent recommendation show unusable decimals like 194.25?"
> **Domain expert:** "No — a **Next-Weight Recommendation** should be rounded to the nearest five."

> **Dev:** "Should 5/5/3/AMRAP use the generic five percent next-weight recommendation?"
> **Domain expert:** "No — the MVP does not model the **RM Calculator**, so 5/5/3/AMRAP only shows eligibility."

> **Dev:** "If progression conditions are not met, should the app show a repeat-weight or failure message?"
> **Domain expert:** "No — progression prompts appear only when the lift appears eligible to progress."

> **Dev:** "If last week's row is blank, should the app show blank history?"
> **Domain expert:** "No — show the **Previous Lift Log**, meaning the nearest earlier nonblank entry for that lift."

> **Dev:** "If a lift name is slightly renamed, should history be lost?"
> **Domain expert:** "No — use **Lift Identity** to match reasonably similar lift names."

> **Dev:** "If T-Bar Row could match both Pronated T-Bar Row and NG T-Bar Row, should the app guess?"
> **Domain expert:** "No — **Lift Identity** must fail closed when the match is ambiguous."

> **Dev:** "Should Lower A use Lower B's calf raise history if the lift names match?"
> **Domain expert:** "No — **Previous Lift Logs** are scoped to the same **Workout Session**."

> **Dev:** "If the **Source Spreadsheet** has reps but no weight for a lift, should the **PWA** refuse to show it?"
> **Domain expert:** "No — the **PWA** should show existing values faithfully, but require valid data when saving."

> **Dev:** "If Eduardo completes Upper B before Lower A, should the app block it?"
> **Domain expert:** "No — **Session Order** is advisory, not enforced."

> **Dev:** "If the coach adds a lift after a session was previously complete, does the app preserve the old complete status?"
> **Domain expert:** "No — for the MVP, completion is interpreted against the current **Program Definition**."

> **Dev:** "If the target is 7+ reps and Eduardo gets 6, should the app reject the entry?"
> **Domain expert:** "No — a **Set Result** records the actual rep count."

> **Dev:** "Does a rep target define the same thing as a completed set result?"
> **Domain expert:** "No — a **Rep Target** is coach-authored guidance; a **Set Result** is what Eduardo actually completed."

> **Dev:** "Does `7+` define a range maximum of seven?"
> **Domain expert:** "No — `7+` defines a **Rep Floor**, not a **Rep Range Maximum**."

> **Dev:** "Should the app convert kilograms to pounds?"
> **Domain expert:** "No — **Lift Weight** is entered in the same implicit unit as the **Source Spreadsheet**."

> **Dev:** "If Eduardo logs two lifts from Lower A and skips the rest, should the app block saving?"
> **Domain expert:** "No — saving writes the entered **Lift Logs** and leaves the other lifts unchanged."

> **Dev:** "If a lift was logged on the wrong week, should Eduardo be able to blank it from the app?"
> **Domain expert:** "Yes — that is a deliberate **Clear**, not an untouched lift."

## Flagged ambiguities

- "database" was used as an analogy for the **Source Spreadsheet** — resolved: the spreadsheet is authoritative, but domain language should call it the **Source Spreadsheet**.
- "workout" can mean either a gym visit or a programmed sheet — resolved: use **Workout Session** for the programmed sheet, and avoid modeling gym visits unless that becomes a separate requirement.
- "same weight for the session" could mean one weight for all lifts or one weight per lift — resolved: each **Lift Log** has one **Lift Weight** shared across that lift's sets.
