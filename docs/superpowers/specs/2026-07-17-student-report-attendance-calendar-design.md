# Student Admin Report — Attendance Month Calendar

## Purpose

The attendance tab of the admin student detail report
(`src/pages/admin/components/studentReport/StudentAttendanceReportTab.tsx`) is a flat table: one row
per expected session, ordered by date. It answers "what happened on 8 July?" but not the questions an
admin actually opens the report to answer:

- "Is this student's absence **clustered** — every Wednesday, or the week of the 12th?"
- "Which sessions has the teacher **not marked yet**, and are they all in one class?"

A month grid answers both at a glance. The teacher salary view already ships exactly this layout
(`src/components/finance/TeacherPayroll.tsx:303`), so the pattern is proven in this codebase and
familiar to the same staff who read this report.

## Decisions Locked With Product Owner

1. **Session logic stays server-side; only the *display* vocabulary comes from the parent view.**
   `buildExpectedStudentSessions` (`shared/studentAttendanceReport.ts:57`) remains the authority on
   which days count. It already handles holidays, cancelled sessions, makeups, enrolment date and
   future-date exclusion. The parent heatmap's `daysOfWeek` check
   (`src/pages/parent/hooks/useParentDashboardState.ts:554`) is a naive client-side approximation
   that knows none of those things; adopting it would be a regression.
2. **One month at a time, with prev/next navigation** — matching the salary calendar, rather than
   stacking every month of a course.
3. **One chip per session inside the day cell**, carrying class name + status, coloured by the
   parent's status vocabulary. Not a whole-cell tint: a day can hold sessions from several classes
   when the class filter is "Tất cả", and a single tint would have to pick one to misrepresent.
4. **The flat table is replaced, not kept alongside.**

## Current System Context

| Layer | Location |
| --- | --- |
| Page | `src/pages/admin/StudentAdminReport.tsx` |
| Tab (to change) | `src/pages/admin/components/studentReport/StudentAttendanceReportTab.tsx` |
| Client filter (pure) | `src/lib/reports/studentReportFilter.ts` |
| Domain (pure) | `shared/studentAttendanceReport.ts` |
| Layout reference | `src/components/finance/TeacherPayroll.tsx:303-380` |
| Logic reference | `src/pages/parent/hooks/useParentDashboardState.ts:504-570` |

Rows reaching the tab are `StudentAttendanceReportRow`: `date`, `classId`, `termKey`, `status`,
`absentWithPermission`, `minutesLate`, `source: 'scheduled' | 'makeup'`. **There is no session
time** — unlike the payroll calendar, whose chips show `startTime`. Chips here carry class name and
status only.

### What the two reference implementations each contribute

| Concern | Source | Why |
| --- | --- | --- |
| Month grid bounds, `grid-cols-7`, out-of-month greying, today pill, chip stack | `TeacherPayroll` | Proven layout, `date-fns` helpers already imported in the repo |
| Status → colour mapping, "no class" vs "no data" distinction | Parent heatmap | The vocabulary staff already read on the parent screen |
| Which days have a session at all | `buildExpectedStudentSessions` | The only source that knows about holidays and cancellations |

## The Correctness Trap: A Calendar Asserts Things A Table Never Did

This is the load-bearing constraint of this design.

`filterStudentReport` returns `attendanceMode: 'expected' | 'marked_only' | 'mixed' | 'none'`
(`src/lib/reports/studentReportFilter.ts:43`). Per decision 2 of the
`2026-07-17-student-report-course-filters` spec, an archived course **without** a schedule snapshot
runs in `marked_only` mode: the server **synthesises no `unmarked` rows and no expected sessions**.
Only real attendance rows exist.

A flat table is safe under both modes because it only ever lists rows that exist. It makes no claim
about a day it does not show. **A calendar renders every day of the month, so an empty cell is
itself an assertion.** Under `marked_only`, that assertion cannot be "Không có lịch học" — the data
cannot distinguish a holiday from a session nobody marked. Rendering one would fabricate exactly the
certainty decision 2 was written to prevent.

The calendar therefore takes `attendanceMode` as a required prop and changes what an empty cell
means:

| Mode | Empty cell means | Caption shown above the grid |
| --- | --- | --- |
| `expected` | No session scheduled — **conditional, see below** | none — the grid is trustworthy as-is |
| `marked_only` | Unknown: no session **or** nobody marked it | reuse existing `modes.markedOnlyHint` |
| `mixed` | Varies by course | neutral label + the existing `modes.mixed` warning |
| `none` | — | calendar not rendered; existing empty state instead |

Under `marked_only` and `mixed`, empty cells render with a hatched/neutral treatment distinct from
`expected`'s plain blank, and the legend swaps "Không có lịch học" for "Không có dữ liệu". The two
modes must never be conflated — the KPI strip already labels them
(`StudentReportKpis.tsx`, `modes.markedOnly` / `modes.mixed`), and the calendar must agree with it.

### `expected` mode is not uniformly trustworthy — two more gaps in the same class as decision 1

Decision 1 already states that `buildExpectedStudentSessions`'s caller pre-filters scheduled dates
for "future-date exclusion" (`shared/studentAttendanceReport.ts:51-52`). That fact has a consequence
this spec's first draft missed: **`rows` never contains an expected session for today-or-later**, by
design, in every mode — not just `marked_only`. A calendar renders the *entire* month, including its
future days. An empty cell on 28 July, viewed on 17 July, is empty because the day has not happened
yet, not because the server determined no session is scheduled. Labelling it "Không có lịch học"
under `expected` mode is exactly the fabrication the mode-aware caption above exists to prevent —
just from a second, independent cause.

The second cause is symmetric: `filterStudentReport`'s `withinRange` (`studentReportFilter.ts:88-92`)
drops any row outside the admin's optional date-range filter, *within an otherwise-`expected`
segment*. If the filter's `to` is 15 July, `rows` holds nothing for 16–31 July regardless of what
actually happened those days — the calendar must not read that absence as "no class scheduled"
either.

Both causes are precisely computable — from `todayIso` and the filter's `from`/`to`, both already
available where the grid is built — so the fix is a second, per-cell dimension rather than a third
attendance mode:

```ts
export type CalendarCoverage = 'covered' | 'future' | 'outside_range';
```

An empty cell may only render as "Không có lịch học" when **both**
`attendanceMode === 'expected'` **and** `cell.coverage === 'covered'`. Every other empty cell —
regardless of *why* it lacks coverage — uses the same neutral/hatched "Không có dữ liệu" treatment
already defined for `marked_only`/`mixed`. This deliberately does not introduce a third visual style
for "hasn't happened yet" distinct from "genuinely unknown": both are cases where the grid cannot
back a claim, and one hatch pattern for "empty, unproven" is simpler than three that a reader would
have to learn to distinguish. A single month can legitimately need both legend entries at once — a
past-but-covered empty day reading "Không có lịch học" alongside a future empty day in the same grid
reading "Không có dữ liệu" — so the legend renders each entry conditionally, only when at least one
visible cell needs it, rather than picking one label for the whole grid.

`class_sessions` truncation (`truncation.classSessions`, global boolean, no per-date signal) is
deliberately **not** folded into `coverage`. Unlike the two causes above, truncation carries no
information about *which* dates it affected, so a per-cell state for it would be unfounded precision.
The existing page-level banner (`StudentAdminReport.tsx:193`, `report-truncated-warning`) already
discloses it independent of which tab is open; this spec relies on that rather than inventing a
per-cell state the data cannot support.

### A reversed date range must be normalized the same way `filterStudentReport` already does

`filterStudentReport` swaps a reversed `from`/`to` before filtering rows, "rather than silently
matching nothing" (`studentReportFilter.ts:111-115`). The grid builder receives the same raw,
possibly-reversed `from`/`to` from the page — not the already-swapped range `filterStudentReport`
computed internally for its own use — so if it compared against them directly, `rows` and `coverage`
would disagree about which days are in range. Concretely, with `from=2026-07-20, to=2026-07-05`:
`rows` would correctly hold sessions for 5–20 July (swapped before filtering), while an unswapped
`coverage` check would mark nearly the entire month `outside_range`, including days `rows` already
proves are in scope. The fix is a single normalization step applied once per grid build, before
`coverage` is computed for any cell — not a change to `computeCoverage` itself, which already handles
a well-formed `{ from, to }` correctly.

## Domain Model

New pure module **`src/lib/reports/studentAttendanceCalendar.ts`** — no React, no dates from the
ambient clock, matching the `studentReportFilter.ts` pattern beside it.

```ts
export type CalendarStatusKey =
  | 'present' | 'late'
  | 'absent_with_permission' | 'absent_without_permission'
  | 'unmarked';

export type CalendarSession = {
  classId: string;
  statusKey: CalendarStatusKey;
  minutesLate: number;
  isMakeup: boolean;          // row.source === 'makeup'
};

/** See "expected mode is not uniformly trustworthy" above. */
export type CalendarCoverage = 'covered' | 'future' | 'outside_range';

export type CalendarCell = {
  iso: string;                // YYYY-MM-DD
  day: number;                // 1..31
  inMonth: boolean;
  isToday: boolean;
  coverage: CalendarCoverage;
  sessions: CalendarSession[];  // empty = see the mode table above, gated by coverage
};

export type CalendarDateRange = { from?: string; to?: string };

/** Normalizes a reversed `from`/`to` — see "reversed date range" above.
 *  Applied once per grid build, before `coverage` is computed. */
// function normalizeRange(range?: CalendarDateRange): CalendarDateRange | undefined; (module-private)

/** Distinct 'YYYY-MM' present in rows, ascending. Empty when rows is empty.
 *  Excludes any row whose date is shaped like YYYY-MM-DD but names no real
 *  calendar day (e.g. '2026-02-30') — see Error Handling. */
export function listAttendanceMonths(rows: StudentAttendanceReportRow[]): string[];

/** Monday-first grid covering the whole month, including leading/trailing days. */
export function buildAttendanceMonthGrid(
  rows: StudentAttendanceReportRow[],
  month: string,             // 'YYYY-MM'
  todayIso: string,          // injected, never read from the clock
  range?: CalendarDateRange, // the admin's optional date-range filter
): CalendarCell[];

/** Clamp a selection to the months that still exist after a filter change. */
export function resolveSelectedMonth(
  available: string[],
  selected: string | null,
): string | null;             // null when available is empty
```

`statusKey` reuses `classifyStudentAttendanceRow` (`shared/studentAttendanceReport.ts:191`) rather
than re-deriving the absent-with-permission split — that classification already exists and must not
fork.

`todayIso` is a parameter, not `new Date()`, so the grid is testable without freezing the clock. The
page already computes Vietnam-local today via `getVietnamTodayStr()`
(`StudentAdminReport.tsx:21`); that value threads through. This matters: a `new Date()` inside the
builder would highlight the wrong cell for staff whose machine clock is off UTC+7.

## Components

| Component | Change |
| --- | --- |
| `components/studentReport/StudentAttendanceCalendar.tsx` | **New**, presentational only. Props: `cells`, `classMap`, `showClassName`, `attendanceMode`, `t`. No state. Renders each of "Không có lịch học" / "Không có dữ liệu" in the legend only when a visible cell needs it (see the coverage section above) — a grid can need both at once. |
| `components/studentReport/StudentAttendanceReportTab.tsx` | Rewritten. Owns `selectedMonth`, renders month nav + calendar + legend. Keeps the unmarked banner and empty state. Takes two new props, `dateRangeFrom?`/`dateRangeTo?`, threaded straight from the page's `effectiveFilter.from`/`.to` into `buildAttendanceMonthGrid`'s `range` argument. |

### Month navigation

`availableMonths = listAttendanceMonths(rows)` — derived from the **filtered** rows, so it follows
the class/course/date filters automatically.

- Default: the **last** entry (most recent month with data).
- `‹` / `›` step within `availableMonths` and are disabled at the ends. They step through the
  *array*, not through calendar arithmetic, so a mid-course month with no sessions is skipped rather
  than shown as an empty grid.
- When the filter changes and the selected month is no longer available, `resolveSelectedMonth`
  falls back to the last available month. Implemented by deriving during render from
  `useMemo`, not a `useEffect` that writes state — the latter renders one frame of a stale month.

### Day cell

- Out-of-month cells: greyed, no chips (as `TeacherPayroll:324`).
- Today: pill on the date number (as `TeacherPayroll:331`).
- Chips: one per session. Class name shown only when `showClassName` (i.e. the class filter is
  `ALL`) — redundant otherwise. Makeup sessions carry a `↻` marker. `late` chips append
  `minutesLate`.
- Colours reuse the existing `STATUS_CHIP` map already in the tab, which is both the report's
  current palette and the same emerald/amber/rose family the parent heatmap uses — while keeping
  the absent-with-permission split the parent view lacks.

The unmarked warning banner keeps its current behaviour: it counts across the **whole filter**, not
the visible month, and keeps `id="attendance-unmarked-warning"`.

## i18n

New keys under `studentAdminReportPage.attendance` in **both** `src/lib/i18n/locales/vi/pages.ts` and
`.../en/pages.ts`:

`calendarTitle`, `monthLabel` (`'Tháng {month}/{year}'`), `prevMonth`, `nextMonth`, `makeupLabel`,
`noClassLabel` (`'Không có lịch học'`), `noDataLabel` (`'Không có dữ liệu'`), `weekdays`
(`['T2',…,'CN']`), `minutesLateShort` (`'Muộn {n}′'`).

`payroll.days` is **not** reused — different namespace, and the payroll strings are owned by a
different screen that may relabel them.

Existing `attendance.statuses.*` and `modes.*` keys are reused unchanged.

## Error Handling

- `rows` empty → existing empty state (`id="attendance-empty-state"`), calendar not rendered.
- `attendanceMode: 'none'` → same empty state; never render a grid for a selection that spans no
  course.
- A row whose `date` is shape-invalid (not `YYYY-MM-DD`) **or shape-valid but calendar-invalid**
  (`'2026-02-30'`, `'2026-13-01'`) → skipped, never crashes the grid. Both checks are required:
  server-side dates are expected to already be real calendar dates, but the shape regex alone accepts
  strings that are not — `date-fns`'s `parseISO('2026-02-30')` and `parseISO('2026-13-01')` both
  return an `Invalid Date` that `isValid()` rejects, so the second check is cheap and catches what the
  first cannot. This is defence in depth for exactly the class of input the regex looks like it
  guards against but doesn't.
- `month` itself calendar-invalid (reachable only if a corrupt row's date produced a bad 'YYYY-MM'
  that skipped the above check, or a caller bypasses `listAttendanceMonths`) → `buildAttendanceMonthGrid`
  returns `[]` rather than passing an `Invalid Date` into `eachDayOfInterval`.
- Month with sessions only in leading/trailing out-of-month cells → cannot occur:
  `listAttendanceMonths` derives months from row dates themselves.
- A grid's leading/trailing (out-of-month) cell that happens to equal `todayIso` → still flagged
  `isToday: true`. No month guard is applied, matching `TeacherPayroll.tsx`'s existing precedent for
  the same boundary case.

## Testing

Test-driven, `.test.ts` beside the module per repo convention.

| File | Coverage |
| --- | --- |
| `src/lib/reports/studentAttendanceCalendar.test.ts` | **New.** Monday-first week bounds; leading/trailing out-of-month cells flagged `inMonth: false`, including one that equals `todayIso`; `isToday` from the injected `todayIso`, not the clock; several classes on one day → several sessions in one cell; `isMakeup` from `source`; `unmarked` rows produce a chip, not an empty cell; a shape-valid but calendar-invalid row date (`'2026-02-30'`) and an invalid `month` (`'2026-13'`) are both rejected without throwing; `coverage` is `'future'` past `todayIso`, `'outside_range'` outside `range`, `'future'` takes precedence when both apply, `'covered'` otherwise; a **reversed** `range` (`from` after `to`) is normalized before coverage is computed, matching `filterStudentReport`'s own swap; `listAttendanceMonths` on empty rows → `[]` and excludes calendar-invalid dates; `resolveSelectedMonth` clamps a dropped month and returns `null` for empty input |
| `src/pages/admin/components/studentReport/StudentAttendanceCalendar.test.tsx` | **New.** Written before the component (test-first). Renders with the **real** `translations.vi`/`translations.en` objects for the empty-cell-label assertions specifically — `translations` is typed `any` (`src/lib/i18n/translations.ts:9`), so a hand-rolled `t` fixture would pass even if Task 3's real locale files were missing a key or had it in the wrong shape. Covers: "Không có lịch học" only for `coverage: 'covered'` empty cells in `expected` mode; "Không có dữ liệu" for `future`/`outside_range`/non-`expected` empty cells; both legend entries appear together when a grid needs both, and each is omitted when unneeded; a cell with sessions always renders chips regardless of coverage; makeup marker; late-minutes label; class-name toggle |
| `src/pages/admin/components/studentReport/StudentAttendanceReportTab.test.tsx` | **New.** Defaults to the most recent month with data; `‹`/`›` disabled at range ends; skips a gap month; class name hidden when a single class is filtered; `marked_only` shows the hint and the "Không có dữ liệu" legend while `expected` shows "Không có lịch học"; unmarked banner counts the whole filter, not the visible month; a future day within the displayed month never reads "Không có lịch học" even in `expected` mode; a date-range-clipped day produces the same result; a month entirely before `todayIso` (relative to an injected past `todayIso`) shows only "Không có dữ liệu" |

`e2e/admin-student-report.spec.ts` touches only `#tab-attendance` and needs no changes.
`src/pages/admin/StudentAdminReport.test.tsx` mocks the tab wholesale (`:43`); its mock is **extended**
(not merely left alone) to also capture `attendanceMode`, `todayIso`, `dateRangeFrom`, and
`dateRangeTo`, with assertions that the page actually passes the right values — otherwise a future
edit could silently stop wiring `attendanceMode` through and no test would notice, which matters
precisely because that prop is what keeps an empty cell from lying.

## Out Of Scope

- Changing the parent heatmap. Its `daysOfWeek` approximation is a real weakness (it cannot see
  holidays or cancellations) but fixing it means giving the parent view access to expected-session
  data — a separate piece of work with its own auth surface.
- Backfilling schedule snapshots so archived courses leave `marked_only`. Unrecoverable data; the
  mode-aware legend above is the mitigation, not the fix.
- Clicking a day to open a detail modal or edit attendance. The report stays read-only.
- Applying the calendar to the finance tab.
