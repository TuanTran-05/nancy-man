# Calendar Expected Sessions Design

## Problem

The `/calendar` page is blank even when classes exist. The root cause is in the
`calendar-window` read channel: `projectedClassDoc` only returns a small class
projection (`id`, `name`, `teacherId`, `status`, `grade`). `CalendarView`
depends on schedule fields such as `daysOfWeek`, `startDate`, `endDate`,
`schedule`, `startTime`, and `holidays` to generate calendar entries. Because
those fields are missing, the UI cannot expand classes into expected monthly or
weekly sessions.

This is not caused by office teacher-attendance confirmation. Office
confirmation should not decide whether an expected class session appears on the
calendar.

## Goal

Show expected teaching sessions on `/calendar` based on the class timetable:
`startDate`, `endDate`, and `daysOfWeek`. Hide sessions that fall on class or
system holidays. Keep attendance and office confirmation as status indicators,
not as the source of whether a planned session exists.

## Non-Goals

- Do not redesign the calendar layout.
- Do not change teacher payroll behavior.
- Do not change office teacher-attendance marking rules.
- Do not create persisted session documents just to display expected future
  calendar entries.
- Do not fetch unrestricted Firestore class documents directly from the
  frontend.

## Current Data Flow

1. `CalendarView` requests `readChannel('calendar-window', { from, to })`.
2. `readCalendarWindow` loads classes and attendance records for that window.
3. `projectedClassDoc` strips most schedule fields from each class.
4. `CalendarView.getClassesForDay(day)` checks `class.daysOfWeek` to decide
   which classes belong on a day.
5. Because `daysOfWeek` and other schedule fields are absent, no regular class
   cards are rendered.

## Desired Data Flow

1. `calendar-window` returns a calendar-safe class projection containing all
   fields required to compute expected sessions:
   - `id`
   - `name`
   - `teacherId`
   - `status`
   - `grade`
   - `schedule`
   - `daysOfWeek`
   - `startDate`
   - `endDate`
   - `startTime`
   - `room`
   - `holidays`
2. `calendar-window` also returns system holidays from
   `system_settings/holidays` as `systemHolidays`.
3. `CalendarView` stores `systemHolidays` in state.
4. `CalendarView` generates regular expected sessions for each visible date
   only when:
   - class status is not `archived`;
   - the date is between `startDate` and `endDate`, inclusive;
   - the date's weekday is included in `daysOfWeek`;
   - the date is not in the union of `class.holidays` and `systemHolidays`.
5. Substitute requests remain additive/replacement visual information for the
   exact request date. Accepted substitute requests still display as substitute
   entries for teachers and as substitute-marked regular entries for admin and
   office users.
6. Attendance records and class-session confirmation may color or label an
   existing calendar card, but missing attendance must not hide future or
   expected sessions.

## API Design

Update `projectedClassDoc` in `api/read/[channel].ts` to return a richer
calendar-safe projection. This is intentionally still a projection, not a full
document pass-through, so private or finance-only class details stay out of the
calendar channel.

Update `readCalendarWindow` to load `system_settings/holidays` alongside
classes and attendance. If the document does not exist, return an empty array.

The API response shape becomes:

```ts
{
  window: { from: string; to: string };
  classes: CalendarClassProjection[];
  attendance: AttendanceProjection[];
  systemHolidays: string[];
  page: { limit: number };
}
```

## Frontend Design

Update `src/pages/common/CalendarView.tsx` to expect:

```ts
readChannel<{
  classes: Class[];
  attendance: Attendance[];
  systemHolidays?: string[];
}>('calendar-window', ...)
```

Add a local `systemHolidays` state. `getClassesForDay(day)` must use one shared
helper from `shared/classSchedule.ts` to determine whether a class is scheduled
on a date. The helper normalizes the day to `yyyy-MM-dd` and keeps date-range,
weekday, and holiday filtering out of the component.

Add this exported helper to `shared/classSchedule.ts`:

```ts
function isExpectedClassSessionOnDate(
  cls: Pick<SchedulableClass, 'startDate' | 'endDate' | 'daysOfWeek'> & {
    status?: string;
    holidays?: string[];
  },
  date: string,
  systemHolidays: string[] = []
) {
  if (cls.status === 'archived') return false;
  if (!isScheduledClassDate(cls, date)) return false;
  if ([...(cls.holidays || []), ...systemHolidays].includes(date)) return false;
  return true;
}
```

`CalendarView` passes `format(day, 'yyyy-MM-dd')` into this helper. Unit tests
cover the helper directly in `shared/classSchedule.test.ts`.

## Status Semantics

Calendar card existence:

- Comes from expected timetable rules.
- Excludes holidays.
- Does not require attendance records.
- Does not require `class_sessions`.
- Does not require office teacher-attendance confirmation.

Calendar card visual status:

- Substitute request: substitute styling.
- Missing past student attendance: current warning styling may remain as an
  attendance signal, but the card still exists because it is a scheduled
  session.
- Partial attendance: pending-style warning may remain.
- Future or unmarked expected sessions: should still render.

The current legend labels can remain for this fix, even if the wording is not
perfect for "expected" sessions. Text copy changes are outside this scope unless
they are needed for clarity during implementation.

## Error Handling

- If `system_settings/holidays` is missing or malformed, return an
  empty `systemHolidays` array rather than blocking the calendar.
- If a class has invalid or missing schedule fields, skip only that invalid
  expected-session calculation; do not fail the whole calendar.
- Keep existing `calendar-window` validation for `from`, `to`, and maximum
  45-day windows.

## Tests

Add or update API tests in `api/read/action.test.ts`:

- `calendar-window` returns schedule fields required by `CalendarView`.
- `calendar-window` returns `systemHolidays`.
- Existing 45-day validation still passes.

Add or update schedule/helper tests:

- A class scheduled Monday/Wednesday in a month appears only on those weekdays.
- Dates before `startDate` and after `endDate` are excluded.
- Dates in `class.holidays` are excluded.
- Dates in `systemHolidays` are excluded.

At minimum, run:

```powershell
npx.cmd vitest api/read/action.test.ts shared/classSchedule.test.ts
npm.cmd run typecheck
```

## Acceptance Criteria

- `/calendar` shows expected class sessions for the selected month/week when
  classes have valid timetable data.
- Expected sessions do not wait for office "taught" confirmation.
- Expected sessions on class holidays or system holidays are hidden.
- Archived classes remain hidden in `CalendarView`.
- API tests cover the projection fields so this blank-calendar regression does
  not return silently.
