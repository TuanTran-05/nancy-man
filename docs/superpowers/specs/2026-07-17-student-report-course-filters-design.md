# Student Admin Report — Per-Course Filters And Full Enrollment History

## Purpose

The admin student detail report (`/admin/students/:studentId/report`) currently shows attendance and
finance for a rolling date window (default: last 90 days). It cannot answer the questions admins
actually have:

- "How was attendance and tuition for **this specific course (khóa)**?"
- "Show me **everything** for this student, including the courses they took before they transferred
  class or moved up a grade."

Concretely: a student who studied 3 courses in Lớp 3 and 2 courses in Lớp 4 must be viewable as 5
distinct course segments, with attendance and finance scoped to each, and filterable by class,
course, and date range.

## Decisions Locked With Product Owner

1. **Filter model: cascading Lớp → Khóa**, plus an independent date-range refinement. A course always
   belongs to exactly one class, so independent class/course filters would allow empty combinations.
2. **Past-course attendance uses marked sessions only.** Archived courses without a schedule snapshot
   report `attendanceRate = (present + late) / markedSessions` and do not synthesise expected
   sessions. The current course keeps the existing expected-session logic. `reset-course` will
   snapshot schedule data going forward so future archived courses can use the accurate mode.
3. **Load once, filter on the client.** A single request returns the student's full history; changing
   filters is instant with no round-trip. Cursor pagination and the 366-day cap are removed.
4. **Default view: current course, with an always-visible timeline strip** listing every course the
   student has taken, so history is never hidden behind a dropdown.
5. **Course labels use the class's own history ordinal.** A student who joined a class at its 4th
   course sees "Khóa 4", not "Khóa 1" — so "khóa 4 của lớp 4A" refers to the same course on every
   screen and in the class's records. Auto-generated `term.name` strings ("Khoa 2026-05-01 - …")
   are not displayed; labels carry the date range instead.

## Current System Context

### Page and data flow

| Layer | Location |
| --- | --- |
| Page | `src/pages/admin/StudentAdminReport.tsx` (admin only) |
| Tabs | `src/pages/admin/components/studentReport/` |
| Client API | `src/lib/api/studentAdminReportApi.ts` |
| Channel dispatch | `api/read/[channel].ts:126` |
| Reader | `server/api/read/handlers/readers.ts:1629` (`readStudentAdminReport`) |
| Domain (pure) | `shared/studentAttendanceReport.ts`, `shared/studentFinanceReport.ts` |

### The course ("khóa") model already exists

- A class's **current course** is `class.startDate .. class.endDate`.
- **Past courses** are archived into `class.terms[] = { id, name, startDate, endDate }` by the
  `reset-course` operation (`server/api/classes/handlers/classOperationsHandlers.ts:157`).
- **Tuition is already per-course**: `course_fee_ledgers` documents are keyed by
  `(studentId, classId, termStart, termEnd)` (`server/api/classes/helpers/classHelpers.ts:552`).
- **Attendance is not tagged with a course.** `attendance` documents carry only `classId` and `date`,
  so course attribution must be derived from the date falling inside a course's interval.

### Why history must be reconstructed

A student document stores only the **current** `classId`. There is no complete enrollment history:

- `admissions_history` exists (`server/api/lib/admissions/history.ts`) with `class_assigned` and
  `class_changed` actions, but it is **incomplete as a source of truth**:
  - Only `transfer.ts` and the admissions flow write to it. Promotion via class archiving
    (`classSyncHelper.ts:34`) and student import (`studentImportHelper.ts:125`) do **not**.
  - The module dates from the 2026-05-25 admissions spec, so older students have no trail.
  - Field naming is inconsistent: `appendAdmissionHistory` writes `timestamp`, while
    `transfer.ts:159` writes `createdAt`.

Therefore the timeline is reconstructed from **evidence** (ledgers + attendance) — the most complete
signal available, and self-healing as data accrues. One known limit: classes with `tuitionFee <= 0`
never get ledgers (`classHelpers.ts:519`), so a zero-fee course whose sessions were also never
marked leaves no trace and cannot appear. The report shows the student's **evidenced** history, not
a guaranteed-complete one.

### Defects found in the current implementation

1. `readers.ts:1827` maps ledgers but **drops `termStart` / `termEnd`**, and `termLabel` is never
   written by `generateCourseFeeLedgers`. `formatLedgerPeriodKey`
   (`shared/studentFinanceReport.ts:163`) therefore falls back to `dueDate` or the **raw ledger ID**
   in the finance table's period column. The course data exists and is being discarded.
2. Related classes are discovered only from attendance **inside the requested window**
   (`readers.ts:1708`), so a student's older classes disappear from the report entirely.
3. The reader rejects ranges over 366 days, making "all history" impossible.

### Correctness trap: lost schedule data

`reset-course` sets `holidays: []` when starting a new course, and `weeklySessions` may change
between courses. Expected-session counts for **past** courses are therefore not reproducible — public
holidays would be counted as `unmarked` sessions and depress the attendance rate. This drives
decision 2.

## Domain Model: Enrollment Timeline

New pure module `shared/studentEnrollmentTimeline.ts` (no Firestore, unit-testable — matching the
existing `shared/studentAttendanceReport.ts` pattern).

```ts
export type TermKey = string; // `${classId}::${termId}`

export type ClassTerm = {
  termId: string;        // 'current' | 'term_1750000000000' | 'unknown'
  classId: string;
  index: number;         // 1-based ordinal within the class → "Khóa 1", "Khóa 2"
  startDate: string;     // YYYY-MM-DD
  endDate: string;       // YYYY-MM-DD; '' means open-ended
  isCurrent: boolean;
};

export type AttendanceMode = 'expected' | 'marked_only';

export type TimelineSegment = {
  key: TermKey;
  classId: string;
  className: string;     // '' when the class document is missing
  classMissing: boolean;
  grade: number | null;
  term: ClassTerm;
  attendanceMode: AttendanceMode;
};
```

`admissions_history` is **not** read. It was considered as an enrichment for labelling segments
("Chuyển lớp" / "Lên lớp"), but it only covers manual transfers — promotion via class archiving and
student import never write it — so the label would appear arbitrarily on some segments and not
others. A partially-correct label is worse than none. The timeline shows all evidenced history
without it; see Out Of Scope.

### Reconstruction algorithm

1. **Collect class IDs** from `course_fee_ledgers.classId` ∪ `attendance.classId` ∪
   `student.classId` (the current class is included even with no data yet).
2. **Load class documents** in chunks of 30 via `__name__ in`.
3. **Build each class's course list**: archived `terms[]` plus the current course
   `{ id: 'current', startDate, endDate }`. Normalise, dedupe by `(startDate, endDate)`, sort by
   `startDate`, assign 1-based `index`.
4. **Attribute data to courses**: an attendance row joins the course of its `classId` where
   `termStart <= date <= termEnd`; a ledger joins by exact `(termStart, termEnd)` match.
5. **Evidence gate** — a `(class, course)` segment enters the timeline only if the student has **at
   least one attendance row or one ledger** for it.

Step 5 is mandatory, not an optimisation. `class.terms[]` holds **every** course the class has ever
run, including those **before this student joined**. Without the gate, a student who joined Lớp 4A at
its 4th course would show three fabricated segments with 100% absence.

**One exception to the gate**: the current course of the student's *current* class is always
included, even with zero evidence. A student enrolled today has no attendance and possibly no ledger
yet, but the report must still open on their course rather than an empty state. The exception is
safe precisely because `student.classId` proves present enrolment — which is the very thing the gate
is inferring for historical classes. No other course of that class is exempt.

### Edge cases

| Case | Handling |
| --- | --- |
| Class document deleted | Segment with `classMissing: true`, labelled "Lớp không xác định (id)"; data still shown |
| Date falls in a gap between courses | Per-class "Khóa khác" bucket (`termId: 'unknown'`) |
| `endDate` empty (open-ended course) | Treated as open; clamped to today for calculations |
| Ledger without a matching `(termStart, termEnd)` | Falls into the same "Khóa khác" bucket |
| Overlapping course intervals (possible — `reset-course` validates only date format, never the new range against archived terms) | The earliest-starting course wins date attribution |
| More than 5000 attendance rows | `truncation.attendance: true`; UI warns. The cut drops the **oldest** rows, so a course whose only evidence was cut disappears from the timeline — the warning must convey this |
| More than 200 ledgers | `truncation.ledgers: true`; UI warns |

Legacy `periodType: 'monthly'` ledgers need no dedicated branch: only
`scripts/migrate-tuition-records.ts` writes them, its manifest shows a `dry-run` with `total: 0`, and
any such ledger already lands in the "Khóa khác" bucket via the rule above.

### Attendance mode per segment

| Segment | Mode | Reason |
| --- | --- | --- |
| Current course | `expected` | `holidays` and `weeklySessions` are accurate |
| Archived course **with** schedule snapshot | `expected` | Snapshot restores accuracy |
| Archived course **without** snapshot | `marked_only` | Historical schedule data is unrecoverable |

`marked_only` reports `attendanceRate = (present + late) / markedSessions` and omits
`unmarked` / `expectedSessions`. The UI labels the mode so the two are never conflated.

Makeup and cancelled `class_sessions` apply **only to `expected` segments** — and only to segments
actually present in the timeline (a makeup from a course the student never took must not create an
orphaned row). A `marked_only` segment uses its real attendance rows verbatim: an unmarked makeup
session must not synthesise an `unmarked` row, and a real attendance row falling on a
cancelled-session date must not be dropped. One cosmetic exception: a real `marked_only` row that
falls on a makeup date is labelled `source: 'makeup'` rather than `'scheduled'`.

## Backend Changes

### `readStudentAdminReport` (`server/api/read/handlers/readers.ts:1629`)

Response shape:

```ts
{
  student,
  timeline: TimelineSegment[],              // replaces currentClass / relatedClasses
  attendanceRows: [...rows, termKey],       // full history, unpaginated
  ledgers: [...rows, termKey, termStart, termEnd],
  receipts,
  truncation: { attendance: boolean, ledgers: boolean, classSessions: boolean },
  generatedAt,
}
```

- **Removed**: `attendancePage` cursor, the 366-day cap, and the `from` / `to` query params (the
  client filters now). `currentClass` / `relatedClasses` are superseded by `timeline`; only this page
  consumes them.
- Every attendance row and ledger carries its `termKey`, so the client filters without duplicating
  attribution logic.

Queries per request (single student, small data):

| # | Query | Notes |
| --- | --- | --- |
| 1 | `students/{id}` | |
| 2 | `attendance where studentId == X orderBy date desc limit 5000` | See index note below |
| 3 | `course_fee_ledgers where studentId == X limit 200` | Single-field index |
| 4 | `receipts where ledgerId in [...] and status == 'posted'` | Equality-only; index merge |
| 5 | `classes where __name__ in [...]` | Chunked by 30 |
| 6 | `class_sessions where classId in [...] orderBy date asc limitToLast(cap + 1)` | Makeup / cancelled; chunked by 30. `limitToLast` keeps the **newest** sessions when over the cap (the default view is the current course) and the `+1` sentinel makes `truncation.classSessions` exact. Uses the existing `(classId, date)` index |

**Index note.** `firestore.indexes.json` has `attendance (studentId ASC, date DESC)` but **no**
`(studentId ASC, date ASC)`. Query 2 therefore orders by `date desc` to match the existing index
exactly and reverses in memory. **No index migration is required.** Ordering descending also makes
the 5000-row cap truncate the *oldest* rows, which is the correct bias.

### `reset-course` (`server/api/classes/handlers/classOperationsHandlers.ts:157`)

Snapshot the schedule into the archived term so future archived courses qualify for `expected` mode:

```ts
const archivedTerm = {
  id: `term_${Date.now()}`,
  name: `Khoa ${before.startDate || ''} - ${before.endDate || ''}`,
  startDate: String(before.startDate || ''),
  endDate: String(before.endDate || ''),
  holidays: Array.isArray(before.holidays) ? before.holidays : [],
  weeklySessions: Array.isArray(before.weeklySessions) ? before.weeklySessions : [],
  daysOfWeek: Array.isArray(before.daysOfWeek) ? before.daysOfWeek : [],
};
```

Purely additive. Existing readers of `terms[]` (`server/api/zalo/handlers/zaloOaHandlers.ts:48`,
`shared/academic.ts`) use only `id` / `name` / `startDate` / `endDate` and are unaffected.

This does **not** retroactively fix already-archived courses — those keep `marked_only` mode, which
is exactly why decision 2 exists.

## Frontend Changes

All under `src/pages/admin/`:

| Component | Change |
| --- | --- |
| `StudentAdminReport.tsx` | Filter state becomes `{ classId, termKey, from, to }`, defaulting to the current class and current course. Date presets removed. The selection unit is `termKey` (`classId::termId`), never bare `termId` — every class has a `current` course, so `termId` alone collides across classes when viewing "Tất cả các lớp". Timeline-strip clicks preserve the date range (the range is an independent refinement per decision 1). |
| `components/studentReport/StudentReportTimelineStrip.tsx` | **New.** Horizontal strip of every segment grouped by class, showing "3 khóa Lớp 3, 2 khóa Lớp 4" at a glance; click to select. |
| `components/studentReport/StudentReportFilters.tsx` | **New.** Cascading Lớp → Khóa dropdowns (course list re-filtered when class changes) plus optional date range. Both dropdowns offer "Tất cả". |
| `components/studentReport/StudentReportKpis.tsx` | Driven by the filtered summary; shows an `attendanceMode` badge. |
| `components/studentReport/StudentAttendanceReportTab.tsx` | Load-more removed; class/course column shown when viewing "Tất cả". |
| `components/studentReport/StudentFinanceReportTab.tsx` | Period column shows the real course label instead of a ledger ID. |
| `src/lib/reports/studentReportFilter.ts` | **New**, pure and unit-tested: filters rows by segment and date range, recomputing summaries with the existing `shared/` functions. |

i18n keys go into `src/lib/i18n/locales/{vi,en}/pages.ts`. **These files already have uncommitted
changes in the working tree** — additions must be merged carefully, not overwritten.

## Error Handling

- Missing class document → `classMissing` segment; never throws.
- Unattributable attendance or ledger → "Khóa khác" bucket; never dropped silently.
- Any `truncation` flag (`attendance`, `ledgers`, or `classSessions`) → one generic
  incompleteness notice on the page ("data exceeded display limits; most recent records shown") —
  a single message, since the user's remedy is the same regardless of which source was cut.
- Student with a class but no data yet → one segment (the current-course exception above); tabs show
  their existing empty states.
- Student with no `classId` and no history at all → empty state, timeline strip hidden.
- Invalid `studentId` → unchanged 404 behaviour.

## Testing

Test-driven, following the repo's convention of a `.test.ts` beside each module.

| File | Coverage |
| --- | --- |
| `shared/studentEnrollmentTimeline.test.ts` | Course building (archived + current, dedupe, open-ended); **evidence gate** (courses predating the student are excluded); **gate exception** (newly-enrolled student with no attendance and no ledger still yields their current-course segment, and no sibling courses of that class leak in); attribution incl. gap → "Khóa khác"; the 3-courses-in-Lớp-3 + 2-in-Lớp-4 scenario yields exactly 5 ordered segments; `attendanceMode` selection |
| `src/lib/reports/studentReportFilter.test.ts` | Cascading filter, date-range intersection, "Tất cả" aggregation |
| `api/read/action.test.ts` | Extend the existing `student-admin-report` channel suite: full history returned, `termKey` present, no 366-day rejection, ledger `termStart`/`termEnd` no longer dropped |
| `src/pages/admin/StudentAdminReport.test.tsx` | Defaults to current course; switching course updates KPIs; timeline strip renders all segments |
| `api/classes/action.test.ts` | `reset-course` snapshots `holidays` / `weeklySessions` / `daysOfWeek` |
| `e2e/admin-student-report.spec.ts` | Existing smoke tests updated: the date-preset test becomes a filter-dropdown test, and the success fixture moves to the new contract. The channel keeps its name — the only consumers are this page and these tests |

## Out Of Scope

- Backfilling schedule snapshots for already-archived courses (data is unrecoverable).
- Unifying the `timestamp` / `createdAt` inconsistency in `admissions_history`.
- Making promotion and student-import paths write `admissions_history`, and the "Chuyển lớp" /
  "Lên lớp" segment labels that would depend on it. Worth doing together, as a separate piece of
  work: the label is only trustworthy once every enrolment-changing path records history.
- Applying course filters to the parent or office views.
