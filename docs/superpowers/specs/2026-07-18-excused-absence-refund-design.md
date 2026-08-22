# Excused-Absence Refund Estimate & Course Enrollment Windows

Date: 2026-07-18
Status: Approved, ready for implementation planning

## Problem

Three related gaps, all rooted in one missing fact: **the system does not know when a student
started belonging to a given course.**

1. **Excused absences carry no monetary meaning.** Attendance already distinguishes
   `absent + permission` from plain `absent` (`shared/studentAttendanceReport.ts:130`), but the
   student report shows only a count. Business rule: at course end, sessions missed *with*
   permission are refundable; without permission they are not.

2. **Mid-course leave (`on_leave`) leaves no trace.** `students.leaveUntil` exists but there is no
   `leaveFrom` and no history. Once a student returns to `active`, the fields are overwritten, so at
   course end there is no way to know which sessions were missed while on leave.

3. **Mid-course joiners show phantom blank attendance.** A student added to a class partway through
   a course gets rows for every prior session rendered as "no data". `enrollmentDate` is a
   *center-wide* join date, not a per-course one, so the existing filter in
   `buildExpectedStudentSessions` does not help a student who transferred classes.

## Scope

**Display-only.** This feature computes and displays monetary estimates on the student detail
report. It does **not** write to `fee_ledgers`, does not create refund records, and does not alter
any existing finance logic. Accounting acts on the number manually.

Out of scope: automatic ledger adjustment, refund approval workflow, payment issuance.

## Decisions

### D1 — Per-session price uses the whole course as denominator

```
pricePerSession = courseFee / courseTotalSessions
```

`courseTotalSessions` is identical for every student in the class and is computed as a **set**:

```
courseTotalSessions = |(generatedWeeklyDates ∪ makeupDates) − cancelledDates − holidays|
```

Makeups must be in the set. A makeup normally *replaces* a cancelled session, so subtracting
cancellations without adding makeups leaves the denominator short by exactly the number of
replacements — and the numerator already counts makeups, because `buildExpectedStudentSessions`
receives them (`readers.ts:1955`) and can label one `on_leave` or `not_enrolled`. A union, not a
sum: a makeup landing on an already-scheduled date must not be counted twice.

Rejected alternative: dividing by the *student's own* eligible sessions, which would give a
mid-course joiner double the unit price of a classmate for the same course.

**`courseFee` resolution depends on whether the course is current.**

| Course | Source |
|---|---|
| `isCurrent` term | `class.tuitionFee`, falling back to a `fee_ledger` matching `termStart` |
| Archived term | **Ledger only**, matched on both `termStart` *and* `termEnd`; no match → `null` |

`class.tuitionFee` must never be used for an archived course. `buildClassTerms`
(`shared/studentEnrollmentTimeline.ts:105`) snapshots each archived term's `schedule` into
`terms[]` but nothing about money, so `class.tuitionFee` on an archived segment is the fee of
whatever course is running *now* — silently pricing 2024's course at 2026's rate. Matching on
`termStart` alone is not enough either, since a re-run course can share a start date; the ledger
already carries both bounds (`server/api/classes/helpers/classHelpers.ts:554`).

Rejected alternative: snapshotting `tuitionFee` into `terms[]`. It is the more correct long-term
fix but requires a schema change plus its own backfill, and this feature is display-only — an
archived course with no ledger renders `—`, which is honest.

Per-student discounts are deliberately *not* applied — D1 requires one shared unit price.

### D2 — "Refundable" and "upfront reduction" are two separate numbers

| Category | Money state | Presented as |
|---|---|---|
| Excused absence, on-leave session | Already paid | **Có thể hoàn** (refundable) |
| Session before joining the course | Never paid | **Giảm trừ đầu khóa** (upfront reduction) |

Confirmed with the user: the office already reduces tuition at intake for mid-course joiners.
Merging the two would present a refund for money the student never paid.

Because that reduction is applied at intake, the "Giảm trừ đầu khóa" figure is **retrospective
reference** — it reconstructs what the reduction should have been, letting accounting reconcile
against what was actually charged. It is not a pending action. The UI copy must not imply money is
owed.

### D3 — Course join dates are keyed by course, not by class

A scalar `student.classJoinedAt` is wrong. Real scenario at this center: a student attends class A
course 2, transfers to class B, then **returns to class A** for course 3. Overwriting a scalar would
make every session of course 2 fall before the stored join date, labelling the student's entire
prior history as "not enrolled".

```ts
export interface StudentCourseJoin {
  classId: string;
  termStart: string;   // = class.startDate of that course, YYYY-MM-DD
  joinedAt: string;    // YYYY-MM-DD
}
```

Joining a class **appends** an entry; it never overwrites.

**Why `termStart` and not `termId`:** `CURRENT_TERM_ID` is the literal string `'current'`
(`shared/studentEnrollmentTimeline.ts:12`). The active course only receives a real id once archived
into `terms[]`, so a key of `classA::current` would silently re-point at the *next* course. Course
`startDate` is stable across archival, `buildClassTerms` already dedupes on it
(`studentEnrollmentTimeline.ts:140`), and `fee_ledgers` already keys on `termStart`/`termEnd`
(`server/api/classes/helpers/classHelpers.ts:554`).

**Lookup fallback:** a segment with no matching entry falls back to the student's centre-wide
`enrollmentDate` as a floor — sessions before it are `not_enrolled`, everything after is eligible.
With no `enrollmentDate` either, the segment is fully eligible.

`enrollmentDate` is deliberately **retained, not removed**. It is the only signal covering the
assignment paths that do not stamp `courseJoins`: `admissions/handlers/createTrial.ts:81` sets
`classId` directly, and other admissions paths may follow. Dropping it would make a brand-new trial
student — whose `enrollmentDate` is today, and whose prior sessions the current filter correctly
hides — start showing phantom blank rows for the whole course to date. That is a regression of the
exact bug this feature exists to fix.

It is a floor, never a ceiling: a matching `courseJoins` entry always wins, and `enrollmentDate`
can only ever mark sessions *earlier* than itself. Stamping `courseJoins` at the admissions paths
is a worthwhile follow-up, but it is not a prerequisite and is out of scope here.

### D4 — Leave periods are stored as history

```ts
export interface StudentLeavePeriod {
  from: string;           // YYYY-MM-DD
  until: string | null;   // ACTUAL return date. null = currently on leave.
  plannedUntil?: string;  // the leaveUntil the office entered, for reference only
  classId: string;
  note?: string;
}
```

**`until` is never the planned return date.** It is written once, at the moment the student
actually comes back. `until === null` is therefore the single, unambiguous predicate for "this
period is open" — used by the open-guard, by the close routine, and by the eligibility resolver
alike. Storing the planned date in `until` would make an open period indistinguishable from a
closed one, and a student who returned early could never be closed out.

The planned date still matters (it is what the office promised the parent), so it is kept beside
it as `plannedUntil` — read-only reference, never used in any calculation.

Rejected alternative: auto-writing `absent + permission` attendance rows for the leave window. That
overwrites real attendance data and cannot be cleanly reversed when a student returns earlier than
planned.

`leaveUntil` is retained unchanged so existing UI keeps working.

### D5 — Real attendance always beats an eligibility label

If a non-voided attendance record exists for a session, it wins — even when eligibility says
`not_enrolled` or `on_leave`. A student on leave who attends one session must show "present", and a
mis-backfilled `joinedAt` must never erase real attendance history.

### D6 — Ineligible sessions are shown, dimmed, and excluded from the rate

Two new statuses render as greyed cells rather than disappearing, keeping the calendar continuous so
parents can see *why* a stretch is empty.

```
attendanceRate denominator = rows.length - notEnrolledSessions - onLeaveSessions
```

## Data Model

All fields on `students/{id}`:

```ts
export interface Student {
  // ...existing
  courseJoins?: StudentCourseJoin[];
  leavePeriods?: StudentLeavePeriod[];
  leaveUntil?: string;   // unchanged, kept for existing UI
}
```

Also requires updating the field allowlist at `firestore.rules:290` and the projections at
`server/api/lib/student/studentProjection.ts:19,41`.

### Write points

| Field | File | Trigger |
|---|---|---|
| `courseJoins` | `server/api/students/handlers/transfer.ts:139-146` | Class transfer |
| `leavePeriods` | `server/api/students/handlers/status.ts` | See transitions below |

**Admissions paths are not stamped in this feature.** `createTrial.ts:81` assigns `classId`
directly without a join entry, and there may be sibling paths. Rather than chase every one, the D3
`enrollmentDate` floor covers them all — including any added later. Stamping `courseJoins` at
admissions is a follow-up that would improve precision (it keys per course rather than centre-wide)
but changes no behaviour that the floor does not already handle correctly.

**Deliberately NOT written on roster import** (`studentImportHelper.ts`): that path copies a whole
roster into a target class, and those students belong to the new course from its start regardless of
when the office ran the import. Stamping `joinedAt: today` would mark every session between the
course start and the import date as `not_enrolled` for the entire class. Stamping
`joinedAt: termStart` would be correct but is exactly equivalent to writing nothing, given the D3
fallback. So: write nothing, and keep a regression test asserting it.

**Deliberately NOT written on status change** (`status.ts`): a status change never moves a student
between classes, so it cannot begin a course. Reactivating a dropped student is covered by the leave
mechanism, not by a join entry.

Leave transitions:

- `active → on_leave`: push `{ from: today, until: null, plannedUntil: leaveUntil, classId }` —
  `until` stays `null` because the student has not returned yet
- `on_leave → active`: close the open period with `until = today` — the **actual** return date, not
  the planned `plannedUntil`
- `→ dropped`: close the open period

### Backfill

New script `scripts/backfill-student-class-joined-at.ts`, following the existing shape of
`scripts/backfill-student-enrollment-dates.ts` (dry-run mode plus a JSON manifest).

For `courseJoins`: walk the student's attendance, group by `(classId, termStart)` via
`findTermForDate`, take `min(date)`. **If that date is the course's first scheduled session, write no
entry** — the student was there from the start. Only write when the student demonstrably joined
later.

Three safety rules, all of which mean "write nothing when the evidence is weak":

- **Skip voided attendance.** A voided row is a retracted claim; inferring a join date from one
  invents a `not_enrolled` band from data the office already withdrew.
- **"First session of the course" excludes holidays *and* cancelled sessions.** Using the raw
  generated schedule makes a course that opened on a later-cancelled date look like it started
  earlier, so every student appears to have joined late.
- **If the course's first session cannot be determined, write no entry.** The current planner
  writes one anyway when `firstScheduledDate` returns `null` — precisely the case with the least
  evidence. Unknown course start means the "was the student here from the start?" test cannot run,
  and the D3 fallback already handles a missing entry safely.

Known limitation: a student absent on their actual first session is inferred one session late.
Acceptable for historical data; new data is written directly at assignment time and is unaffected.

`leavePeriods` is **not** backfilled for history — `leaveFrom` never existed, so past leave windows
are unrecoverable. But students currently `on_leave` at migration time **must** get one open period,
and the backfill script is the only thing that can create it: without it, a student already on leave
stays invisible to the feature until someone happens to toggle their status.

```ts
{ from: statusChangedAt ?? today, until: null, plannedUntil: leaveUntil, classId }
```

`until: null` per D4 — the student has not returned. This ships in the same script and the same
dry-run manifest as `courseJoins`.

## Domain Modules

### `shared/studentSessionEligibility.ts` (new)

```ts
export type SessionEligibility = 'eligible' | 'not_enrolled' | 'on_leave';

export function resolveSessionEligibility(
  date: string,
  classId: string,
  ctx: { joinedAt: string | null; leavePeriods: StudentLeavePeriod[] },
): SessionEligibility;
```

Rules, in order: `date < joinedAt` → `not_enrolled`; inside a leave period of the same `classId`
(`from <= date && (until === null || date <= until)`) → `on_leave`; otherwise `eligible`. A null
`joinedAt` yields `eligible` — never guess.

### `shared/studentAttendanceReport.ts` (modified)

- `AttendanceStatus` gains `'not_enrolled' | 'on_leave'`
- `buildExpectedStudentSessions` **labels instead of filtering**: the `enrollmentDate` parameter
  (line 61) is replaced by an eligibility context, and ineligible sessions are retained with a label
  rather than dropped (line 68)
- `mergeExpectedSessionsWithAttendance` applies D5
- `AttendanceSummary` gains `notEnrolledSessions`, `onLeaveSessions`; `expectedSessions` per D6
- `classifyStudentAttendanceRow` returns the two new keys

### `shared/studentRefundEstimate.ts` (new)

```ts
export function estimateSessionValue(input: {
  courseFee: number;
  courseTotalSessions: number;   // whole course, future sessions included
  excusedAbsences: number;
  onLeaveSessions: number;
  notEnrolledSessions: number;
}): {
  pricePerSession: number | null;
  refundable:  { sessions: number; amount: number };
  notEnrolled: { sessions: number; amount: number };
};
```

Returns `pricePerSession: null` when `courseTotalSessions === 0` or `courseFee <= 0`. Never divides
by zero, never silently reports 0đ.

## Server Read Path

`server/api/read/handlers/readers.ts`, replacing lines 1959–1969:

1. Read `courseJoins` and `leavePeriods` from `studentData`
2. Pass eligibility context to `buildExpectedStudentSessions`
3. **Separate denominator pass:** for each `expected`-mode `TimelineSegment`, re-run
   `getScheduledClassDatesInRange` over `term.startDate → term.endDate` **without the
   `isFutureVietnamDate` guard** (line 1907), then union in makeup dates and subtract holidays and
   cancelled sessions per D1.

   > This is the highest-risk step in the design. The existing loop truncates at today; reusing it
   > mid-course yields a short denominator and inflates `pricePerSession` — for a course at its
   > halfway point, roughly double. It must be a distinct loop that does not share the
   > `scheduledDates` accumulator.

   It also needs `cancelledKeys` and `makeupSessions`, which section 7 populates (line 1919), so it
   must be placed **after** the `class_sessions` fetch — not immediately after the section-6 loop.

4. Resolve `courseFee` per D1

### Role scope: `sessionValueByTerm` is admin-only

The reader deliberately splits `canAcademic` (admin/office/teacher) from `canFinance`
(admin/accounting) at `readers.ts:1717-1718`. The estimate needs both: attendance labels come from
the academic branch, `ledgers` are only fetched under `canFinance` (line 1779).

Computing it in the academic branch alone would do two wrong things at once — hand tuition figures
to teachers, and give office/teacher an empty `ledgers` array so the fallback silently resolves to
`0đ` while an admin viewing the same student sees the real number. **Emit `sessionValueByTerm` only
when `canAcademic && canFinance`** — today, only `admin`. Every other role receives `{}`, and the UI
renders nothing rather than a zero.

Response gains, keyed by `termKey` to match the existing course filter:

```ts
sessionValueByTerm: Record<TermKey, {
  courseTotalSessions: number;
  pricePerSession: number | null;
  refundable:  { sessions: number; amount: number };
  notEnrolled: { sessions: number; amount: number };
}>
```

## UI

| File | Change |
|---|---|
| `src/lib/reports/studentAttendanceCalendar.ts:21` | `CalendarStatusKey` gains `not_enrolled`, `on_leave` (flows through `classifyStudentAttendanceRow`) |
| `StudentAttendanceCalendar.tsx` | Two dimmed grey cell styles plus legend entries |
| `StudentReportKpis.tsx` | Excused-absence KPI shows the equivalent amount |
| `StudentAttendanceReportTab.tsx` | Summary block: unit price, "Có thể hoàn", "Giảm trừ đầu khóa" |
| `src/pages/common/StudentProfilePage.tsx` | The parent: owns the term selection and passes the estimate down to both children |
| `src/lib/reports/studentReportFilter.ts` | Verify the status filter does not swallow the two new values |
| `locales/{vi,en}/{components,pages}.ts` | New labels, with a note that the figure is an estimate not yet applied to any balance |

The `AttendanceStatus` union in `api/attendance/[action].ts:25` is a separate same-named type for
teacher marking (`present | absent | late`) and is unaffected.

### When the estimate is shown at all

A pure selector owns this, so it is testable without rendering:

```ts
export function selectTermSessionValue(
  sessionValueByTerm: Record<string, TermSessionValue>,
  filter: { termKey: string | typeof ALL; range: DateRange },
): TermSessionValue | null;
```

Returns `null` — and the UI renders nothing — in three cases:

1. **`termKey === ALL`.** Courses have different unit prices; a blended total is misleading.
2. **A date range is active.** The figures are whole-course by construction (D1), but
   `studentReportFilter.ts:121` filters rows by `withinRange`. Showing "3 buổi có thể hoàn" beside
   a table displaying one of them is worse than showing nothing. Recounting from the filtered rows
   was rejected: it makes the refund figure move as the user scrubs dates, which reads like the
   money changed.
3. **No entry for the selected `termKey`** (non-admin role, or an unpriceable course).

## Testing

New pure modules are built test-first. Required cases:

- Session before `joinedAt` → `not_enrolled`; a real attendance record overrides it (D5)
- Open leave period (`until: null`) covers through today; two disjoint leave periods
- Leave period for a different `classId` does not apply
- Returning to a previous class in a later course leaves the earlier course un-labelled (D3)
- A student returns **before** `plannedUntil` — the period closes at the actual date (D4)
- `courseTotalSessions` counts future sessions — guards the inflated-unit-price bug. Because the
  reader calls `getVietnamTodayStr()` internally with no injection point (`readers.ts:1707`), this
  case **must** use `vi.useFakeTimers()` + `vi.setSystemTime()`. A `today:` argument passed to a
  test helper is inert and the test would pass whether or not the bug exists.
- A cancelled session replaced by a makeup leaves `courseTotalSessions` unchanged (D1 union)
- `courseFee = 0` and `courseTotalSessions = 0` → `pricePerSession === null`
- An archived course with no matching ledger → `pricePerSession === null`, *not* the current
  `class.tuitionFee`
- Attendance rate excludes `not_enrolled` and `on_leave` from the denominator (D6)
- A student with no `courseJoins` entry but an `enrollmentDate` gets the floor applied (D3)
- `selectTermSessionValue` returns `null` for `ALL` courses and for an active date range
- Non-admin roles receive `sessionValueByTerm === {}`

Updates required: `shared/studentAttendanceReport.test.ts` — the case
`excludes sessions before enrollmentDate` (line 67) changes meaning from *drops* to *labels*;
`api/read/action.test.ts`; and a backfill script test mirroring
`scripts/backfill-student-enrollment-dates.test.ts`.

## Implementation Order

1. Types, `firestore.rules`, student projection
2. Pure domain modules, test-first
3. Server read path
4. Backfill script — dry-run and manifest review before the live run
5. UI and i18n

Each step is independently shippable. The D3 fallback (no entry → fully eligible) means a partial
rollout degrades to current behaviour rather than breaking.
