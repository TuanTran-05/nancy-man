# Attendance Session Eligibility Across Class Views

Date: 2026-08-13
Status: Approved for implementation planning

## Problem

The application persists attendance only when a student is marked `present`, `absent`, or `late`.
An absent document therefore has three possible meanings that the class attendance grid currently
collapses into the same blank cell:

1. the student had not joined that course yet;
2. the student was on approved leave for that session; or
3. the student was enrolled but attendance has not been entered.

The student report and attendance quick profile already distinguish these cases with
`not_enrolled`, `on_leave`, and `unmarked`. The class attendance grid, its "mark all present"
operation, the PDF export, and the attendance write API do not consistently apply that domain
rule. In particular, once a student returns from `on_leave` to `active`, the grid uses only the
current status and renders every historical leave-day cell as unmarked and writable.

## Goals

- Give every student/session cell one consistent derived status across the class grid, reports,
  quick profile, counters, bulk operations, and PDF export.
- Display sessions before a student's course join date as **Chưa nhập học** (`not_enrolled`).
- Display sessions inside an approved leave interval as **Tạm nghỉ** (`on_leave`).
- Count only eligible blank sessions as **Chưa điểm danh** (`unmarked`).
- Prevent ordinary and bulk attendance actions from accidentally creating records for ineligible
  sessions while preserving a deliberate path for genuine attendance exceptions.
- Reuse the existing enrollment-window model and pure eligibility resolver; do not materialize
  derived placeholder attendance documents.

## Non-goals

- No automatic tuition, ledger, refund, or wallet changes.
- No attempt to invent historical leave periods for dates the system never recorded.
- No unrelated redesign of class scheduling, cancelled sessions, or attendance document identity.
- No deletion or silent rewriting of existing non-voided attendance records.

## Existing Foundation

The approved implementation builds on existing code rather than introducing a second model:

- `StudentCourseJoin { classId, termStart, joinedAt }` records course-specific join history.
- `StudentLeavePeriod { from, until, classId, ... }` records leave history.
- `StudentCourseEnrollment.joinedAt` is the canonical course enrollment source when available.
- `createEligibilityResolver` already resolves `eligible | not_enrolled | on_leave`.
- `mergeExpectedSessionsWithAttendance` and student-report summaries already support the two
  ineligible statuses and exclude them from the attendance-rate denominator.
- `CanonicalStudentReadRow.currentEnrollment` already contains `classId`, `termStart`, and
  `joinedAt` for the active course; the class roster projection currently drops this information.

## Decisions

### D1 — Ineligible statuses are derived, never stored in `attendance`

The `attendance` collection remains limited to real observations:

```ts
type StoredAttendanceStatus = 'present' | 'absent' | 'late';
```

`not_enrolled`, `on_leave`, and `unmarked` are display/report states derived for a particular
student, class, course term, and session date. No placeholder documents are generated for them.
This avoids backfill fan-out and prevents a later enrollment correction from leaving stale derived
documents behind.

### D2 — One cell-resolution rule is shared by every consumer

For a `(studentId, classId, termStart, date)` cell:

1. A real, non-voided attendance record wins and renders `present`, `absent`, or `late`.
2. Otherwise, if `date < joinedAt`, render `not_enrolled`.
3. Otherwise, if the date is inside a leave interval for the same class, render `on_leave`.
4. Otherwise, render `unmarked`.

This preserves the existing rule that a student on leave who genuinely attends a session must
still appear present. It also prevents imperfect historical enrollment metadata from hiding real
attendance evidence.

The shared domain layer will expose a small pure helper for this merge instead of duplicating the
precedence rule in React components, PDF code, and API handlers.

### D3 — Enrollment join-date precedence is canonical first

For each course term, resolve `joinedAt` in this order:

1. a matching canonical `StudentCourseEnrollment` for `(studentId, classId, termStart)`;
2. an exact `student.courseJoins` entry for `(classId, termStart)`;
3. the student's center-wide `enrollmentDate` as a lower-bound fallback;
4. no join restriction when none of the above is available.

An exact course value is authoritative in both directions and overrides `enrollmentDate`. Missing
or malformed history defaults to eligible rather than guessing that the student was absent from a
course.

For the active course, the class-roster response will project the already-loaded matching canonical
enrollment summary instead of issuing one enrollment query per student. Historical student reports
will resolve the matching row from the full enrollment history they already load. Both paths adopt
the same precedence already used by the attendance quick profile so manual enrollment corrections
cannot make the views disagree.

### D4 — The return date is eligible

Approved business meaning: changing a student from `on_leave` to `active` means the student can be
marked from that Vietnam calendar date onward.

Closed leave intervals therefore use half-open semantics:

```text
from <= sessionDate < returnedAt
```

The persisted `until` value currently contains the actual return date. The resolver will interpret
that boundary as exclusive. An open interval (`until === null`) continues to cover every date from
`from` onward. Because attendance is keyed by date rather than time, the office workflow must use
the calendar day on which the student is again eligible; the model cannot distinguish returning
before versus after a lesson on the same day.

Existing closed leave periods will receive the same interpretation. A pre-implementation audit
must report any return-date attendance conflicts for review; it must not rewrite them
automatically.

### D5 — The class grid renders eligibility per cell, not per current student status

The grid may continue hiding students whose *current* status is `on_leave` unless "show on leave"
is enabled. Once a row is visible, however, every cell is classified by that cell's date:

| Derived cell state | Visual behavior | Normal click |
|---|---|---|
| `present` / `absent` / `late` | Existing colored attendance icon | Editable |
| `not_enrolled` | Dim neutral cell, label/tooltip "Chưa nhập học" | Disabled |
| `on_leave` | Dim leave cell, label/tooltip "Tạm nghỉ" | Disabled |
| `unmarked` | Existing empty-cell affordance, label "Chưa điểm danh" | Enabled |

The grid must not lock every historical cell merely because the student is currently on leave.
Sessions before the leave interval remain editable; cells inside the interval are ineligible.

Accessibility text must state the derived status and date rather than relying on color alone.

### D6 — Bulk operations are eligibility-aware

"Mark all present" builds its target list from the selected date's resolved cells, not from each
student's current `enrollmentStatus`.

- Include eligible `unmarked`, `absent`, or `late` students as the existing product behavior
  requires.
- Exclude `not_enrolled` and `on_leave` students for that date.
- Preserve already-present records.

The server recomputes eligibility to protect against stale clients and direct API calls. A bulk
response returns both updated students and skipped students grouped by `not_enrolled` or
`on_leave`; the UI shows a concise informational toast when anything was skipped. Bulk operations
never accept an eligibility override.

### D7 — Individual attendance exceptions require an explicit action

Ordinary toggle/create requests for an ineligible empty cell return a stable conflict response
containing the resolved reason. A separate confirmed action may create a real attendance record
when, for example, a student on leave attends one lesson:

```ts
{
  eligibilityOverride: true,
  overrideReason: string
}
```

The override uses the caller's existing attendance authorization and is audit-logged with the
eligibility state and reason. Editing an already-existing real attendance record remains allowed,
because real evidence takes precedence under D2. The UI does not place this override on the normal
left-click path; it is exposed through a clearly labelled confirmation flow.

### D8 — Exports and pending counters use the same resolved cells

The class attendance PDF must no longer represent all missing documents as a blank. It uses:

- `P`, `A`, `L` for stored attendance;
- `CNI` for **Chưa nhập học**;
- `TN` for **Tạm nghỉ**;
- blank for genuinely unmarked attendance;
- a legend defining every abbreviation.

Any pending-attendance count includes only `unmarked` eligible sessions. Student report rates
continue excluding `not_enrolled` and `on_leave` from their denominator.

## Architecture and Data Flow

### Shared domain

Extend the existing eligibility modules with a pure cell resolver whose inputs are already parsed
domain values. It must not import Firestore or browser code.

```ts
type AttendanceCellStatus =
  | 'present'
  | 'absent'
  | 'late'
  | 'unmarked'
  | 'not_enrolled'
  | 'on_leave';

resolveAttendanceCellStatus({ attendance, eligibility }): AttendanceCellStatus;
```

`createEligibilityResolver` remains responsible for join and leave windows. The new helper owns
only the "real attendance wins" merge so all consumers use the same precedence.

### Server roster projection

Add an optional, read-only enrollment summary for the attendance view to the class roster DTO:

```ts
attendanceEnrollment?: {
  id: string;
  classId: string;
  termStart: string;
  termEnd: string | null;
  joinedAt: string;
  status: StudentCourseEnrollmentStatus;
};
```

Populate it from `CanonicalStudentReadRow.currentEnrollment` only when its `classId` and
`termStart` match the class's active course. Legacy-read mode or a non-matching enrollment may omit
it; the client then uses `courseJoins` and `enrollmentDate`. Do not persist this summary back onto
the student profile. Historical report paths resolve their own term-matching enrollment rather
than reusing this active-course DTO field.

### Class attendance view

The class view passes the selected course's `termStart` and date range to the attendance tab. The
tab memoizes one eligibility resolver per student and one attendance lookup map keyed by
`studentId|date`; it must not repeatedly scan the entire attendance array inside every rendered
cell.

The resolved cell status drives rendering, disabled state, accessibility text, context actions,
and the bulk target list.

### Server writes

The single and bulk attendance handlers resolve the current course term from class data, load the
matching enrollment context in batches, and apply the same shared resolver before creating new
attendance records. Existing authorization, future-date validation, course-range validation,
identity mutation transactions, and audit logging remain in force.

### Reports and exports

The student report, quick profile, class grid, PDF export, and pending-attendance summaries all call
the shared resolver. They may present the result differently but cannot redefine eligibility.

## Error Handling and Degraded Data

- Missing course term, malformed join history, or missing enrollment data defaults to `eligible`;
  absence of evidence must not invent a `not_enrolled` period.
- Malformed leave entries are ignored by the existing parser and surfaced by an audit/report,
  rather than making the whole class unreadable.
- A stale-client bulk request receives explicit skipped rows; it never silently writes ineligible
  records.
- A normal individual create on an ineligible cell receives a stable conflict code suitable for a
  confirmation UI.
- Existing real attendance conflicting with eligibility remains visible and is included in an
  audit report for correction, never silently deleted.

## Historical Data and Rollout

1. Run the existing course-join backfill/audit in dry-run mode and review its manifest. Prefer
   canonical enrollment values when they exist.
2. Audit students with malformed or missing `courseJoins`, malformed leave periods, and real
   attendance on a newly exclusive return-date boundary.
3. Do not infer old closed leave periods: before `leavePeriods` existed, there is no reliable
   `from` date.
4. Ensure currently open leave periods have a valid `from`, `classId`, and `until: null`.
5. Ship shared/server read support before enabling eligibility-aware UI writes.
6. Ship the grid, counters, PDF, and server write guards together so no active surface continues
   using the ambiguous blank-cell rule.

## Testing

### Pure domain tests

- A session before exact course `joinedAt` is `not_enrolled`; the join date itself is eligible.
- Exact canonical enrollment wins over `courseJoins` and `enrollmentDate`.
- Exact `courseJoins` wins over the center-wide enrollment floor.
- No usable enrollment evidence defaults to eligible.
- Leave start is included; return date is excluded; open leave covers dates from `from` onward.
- Leave periods for another class do not apply.
- `not_enrolled` outranks an overlapping leave period.
- A non-voided attendance record overrides either ineligible state.

### Class grid tests

- An active student reactivated after leave shows historical leave cells as `Tạm nghỉ`, not
  `Chưa điểm danh`.
- Pre-join sessions show `Chưa nhập học` and cannot be toggled normally.
- Eligible empty cells remain writable and show `Chưa điểm danh`.
- The bulk target list excludes per-date ineligible cells, regardless of current student status.
- Accessibility labels and tooltips expose the two derived statuses.

### API tests

- Normal single create rejects an ineligible empty cell with a stable conflict code.
- Confirmed single override succeeds and writes an audit reason.
- Editing an existing real record succeeds even if metadata now says ineligible.
- Bulk update writes eligible students only and returns categorized skipped students.
- Future-date, course-range, class-membership, and role checks continue to pass.

### Export/report tests

- PDF rows render `CNI`, `TN`, and genuine blanks distinctly and include a legend.
- Pending counts exclude both ineligible statuses.
- Attendance-rate denominators continue excluding `not_enrolled` and `on_leave`.
- Student report, quick profile, and class grid agree for the same fixture.

## Acceptance Criteria

- A student joining mid-course no longer has pre-join sessions shown or counted as unmarked.
- A reactivated student retains `Tạm nghỉ` cells for the historical leave interval.
- The return date can be marked normally.
- "Mark all present" cannot mark students who were not enrolled or were on leave on that date.
- Real attendance remains visible and editable under the explicit precedence rule.
- Class grid, quick profile, student report, PDF, pending counters, and APIs produce consistent
  results from the same enrollment history.
- No `not_enrolled`, `on_leave`, or `unmarked` placeholder documents are written to `attendance`.
