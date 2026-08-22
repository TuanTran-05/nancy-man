# Office Teacher List Page Design

## Summary

Add a new teacher list page for the office role at `/teachers`. The page helps office staff review every teacher's contact information, active teaching load, class schedules, and a month calendar that combines planned class sessions with teacher attendance status.

The page is office-only. Admin users should not see the sidebar entry and should not be allowed to access the route.

## Goals

- Show all teacher profiles relevant to office operations.
- Show each teacher's phone number, email, current classes, class schedule, start time, room, and class status.
- Show a month calendar for the selected teacher.
- Calendar cells show planned teaching shifts from class schedule data.
- Existing attendance/session records override planned shifts with actual status when available.
- Keep the page useful for quick office scanning without replacing the existing weekly teacher attendance page.

## Non-Goals

- Do not expose this page to admin users.
- Do not add teacher editing, payroll editing, attendance marking, or class editing from this page.
- Do not remove or redesign the existing `/teacher-attendance` page.
- Do not introduce a new design system or dependency.

## Route And Navigation

- Add lazy route `src/pages/office/Teachers.tsx`.
- Add route path `/teachers`.
- Protect route with office-only access.
- Add a "Giáo viên" item to the office sidebar only.
- Do not add this item to admin navigation.
- Keep the office home redirect unchanged.

## Data Sources

The implementation should use existing app data models and APIs where possible:

- `UserProfile` for teacher identity, email, phone, and blocked status.
- `Class` for current class assignment and recurring schedule fields:
  - `teacherId`
  - `schedule`
  - `daysOfWeek`
  - `startDate`
  - `endDate`
  - `startTime`
  - `room`
  - `status`
  - `terms`
  - `holidays`
- `ClassSession` for actual session and attendance state:
  - `classId`
  - `teacherId`
  - `date`
  - `status`
  - `teacherAttendanceStatus`

Add a narrow monthly read channel for this page that returns teachers, classes, and sessions for the selected month. This avoids stitching together multiple weekly teacher-attendance reads on the client.

## Schedule Calculation

The month view should combine planned schedule and actual sessions:

1. Build planned shifts from class schedule data for the selected month.
2. Respect class `startDate`, `endDate`, `terms`, `daysOfWeek`, and `holidays`.
3. Match sessions by `classId + date`.
4. Apply session status on top of the planned shift:
   - no session: planned / pending
   - `teacherAttendanceStatus === "present"`: taught
   - `teacherAttendanceStatus === "absent"`: absent
   - `status === "cancelled"`: cancelled
   - `status === "makeup"`: makeup
5. Include makeup sessions that fall inside the selected month even when they are not on the recurring planned schedule.

## Layout

Use a two-region operational layout.

### Left Region: Teacher List

- Search input filters by teacher name, email, and phone.
- Each teacher row shows:
  - display name
  - phone number, or "Chưa có SĐT"
  - number of current classes
  - number of planned shifts in the selected month
- The selected teacher row uses the same calm blue active treatment used in the existing app navigation.

### Right Region: Teacher Detail

- Header shows teacher name, phone, and email.
- Metric tiles show:
  - current classes
  - planned shifts this month
  - taught shifts
  - absent/cancelled shifts
- A class table shows:
  - class name
  - schedule
  - start time
  - room
  - status
- A month calendar shows teaching shifts by day.

## Month Calendar

- Calendar starts on Monday to match the current attendance-week behavior.
- Header includes selected month, previous month button, next month button, and a current-month button.
- Each date cell shows:
  - day number
  - up to two shift chips
  - a compact `+N ca` overflow marker when more than two shifts exist
- Shift chips show:
  - start time when available
  - class name
  - status color
- Selecting a day reveals the full list of shifts for that date in a detail strip or side panel below the calendar.

## Status Mapping

- Planned / pending: slate
- Taught / present: emerald
- Absent: rose
- Cancelled: muted amber
- Makeup: blue with a short "Bù" label

The colors should be restrained and consistent with the existing EduTrack admin/office visual language.

## Empty, Loading, And Error States

- Show skeleton rows for the teacher list and calendar while loading.
- If there are no teachers, show a quiet empty state.
- If the selected teacher has no classes in the month, keep the teacher details visible and show an empty calendar message.
- On API/read failures, show a clear error state with a reload button.

## Responsive Behavior

- Desktop: teacher list on the left, teacher detail on the right.
- Mobile/tablet: teacher list above, selected teacher details below.
- Calendar may scroll horizontally on narrow screens to prevent text overlap.
- Calendar cell dimensions should be stable so chips and overflow labels do not resize the layout.

## Accessibility

- Buttons need clear labels or accessible titles.
- Month navigation should be keyboard reachable.
- Search input should have a visible label or aria-label.
- Status chips should use text labels in addition to color.
- Contrast should meet the existing app standard for light and dark modes.

## Testing

Add focused coverage for schedule aggregation:

- planned recurring shifts appear on the correct days
- class holidays remove planned shifts
- present/absent/cancelled sessions override planned status
- makeup sessions appear inside the month even when not recurring
- teacher summary counts match the calendar data

Run typecheck and build after implementation. If a dev server is available, verify the page visually at `/teachers`.

## Open Decisions Resolved

- Layout approach: teacher list first, detail calendar second.
- Access: office role only.
- Calendar source: combined planned schedule plus attendance/session status.
- Admin visibility: no admin navigation and no admin route access.
