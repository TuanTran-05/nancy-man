# Teacher Attendance Design

## Goal

Replace teacher self-confirmation of class sessions with an office/admin teacher-attendance
workflow. A scheduled class session counts toward payroll only when office/admin confirms that
the assigned teacher was present.

The workflow mirrors student attendance at a higher level: office/admin reviews the weekly class
schedule, sees which teacher is assigned to each session, and marks that session as present or
absent for payroll and operational tracking.

## Current Context

The existing app stores class-session confirmation in `class_sessions`.

- `ClassAttendanceTab` currently shows session controls inside the class attendance table.
- `handleConfirmSession` calls `/api/v1/edu/evaluation-confirm-session`.
- The API writes `class_sessions/{classId}_{date}` with `status: taught | cancelled | makeup`.
- `TeacherPayroll` reads `class_sessions`, but currently defaults scheduled dates with no session
  record to taught.
- Student attendance remains in the `attendance` collection and is separate from this feature.
- Substitute requests already update the session teacher for accepted substitute sessions.

## Product Decisions

- Teacher attendance is tracked per class session, not per teacher-day.
- A teacher with multiple classes in one day can be present for one session and absent for another.
- Substitute teaching uses the existing substitute request flow. The teacher-attendance page marks
  the teacher currently assigned to the session, whether original or substitute.
- Sessions without `teacherAttendanceStatus: present` do not count toward payroll from the rollout
  date forward.
- Office/admin cannot mark future sessions.
- `absent` is only the teacher work-attendance state. It does not automatically cancel the class.
- Cancelled sessions remain a separate session state and do not require teacher attendance marking.
- Absence notes are optional.
- Admin/office get a dedicated teacher-attendance page. Teachers do not get that page.
- Teachers may see read-only teacher-attendance status in their payroll detail.
- Makeup sessions are included in teacher attendance and payroll when marked present.
- Legacy payroll history before the rollout date keeps the current calculation behavior.
- Payroll remains monthly: from day 1 through the last day of the selected month. A class ending
  mid-month contributes any confirmed present sessions within that month, but fixed scheduled
  sessions are not generated past the class end date. Makeup sessions can still count after the end
  date if they exist and are marked present.

## Recommended Approach

Extend `class_sessions` with teacher-attendance fields instead of creating a new collection.

This keeps the source of truth for session-level teaching activity in one place. It also avoids
joining separate attendance records during payroll and works naturally with existing substitute and
makeup session records.

## Data Model

Existing `class_sessions/{classId}_{date}` fields stay valid:

```ts
interface ClassSession {
  id: string;
  classId: string;
  teacherId: string;
  date: string;
  status: 'taught' | 'cancelled' | 'makeup';
  salaryPerSession: number;
  createdAt: string;
  updatedAt?: string;
  notes?: string;
}
```

Add optional teacher-attendance fields:

```ts
type TeacherAttendanceStatus = 'present' | 'absent';

interface ClassSession {
  teacherAttendanceStatus?: TeacherAttendanceStatus;
  teacherAttendanceMarkedBy?: string;
  teacherAttendanceMarkedByRole?: 'admin' | 'office';
  teacherAttendanceMarkedAt?: string;
  teacherAttendanceNote?: string;
  teacherAttendanceSource?: 'office_admin';
}
```

Do not persist `pending`. Pending is derived when a session has no `teacherAttendanceStatus`.

For fixed scheduled sessions without a `class_sessions` document, the weekly page renders a virtual
session. When office/admin marks it for the first time, the API creates
`class_sessions/{classId}_{date}` with:

- `classId`
- `date`
- `teacherId` from the class or accepted substitute request
- `status: 'taught'`
- `salaryPerSession` copied from the class
- `createdAt` and `updatedAt`
- `teacherAttendanceStatus`
- marker metadata

## Weekly Read Model

Add a server read channel:

```http
GET /api/v1/read/teacher-attendance-week?from=YYYY-MM-DD&to=YYYY-MM-DD
```

The endpoint returns a week-sized view for admin/office. It should be usable for adjacent weeks, not
only the current week.

It combines:

- Classes whose date range intersects the requested window.
- Fixed scheduled sessions derived from `classes.daysOfWeek`, `startDate`, `endDate`, and
  `schedule/startTime`.
- Existing `class_sessions` in the requested date window, including `makeup` and `cancelled`.
- Accepted substitute requests for dates in the requested window, so the displayed `teacherId` is
  the teacher who should be marked.
- Teacher display names and class display data needed by the UI.

Response shape:

```ts
interface TeacherAttendanceWeekResponse {
  sessions: TeacherAttendanceSessionRow[];
  teachers: Array<{ uid: string; displayName: string; email?: string }>;
  classes: Array<{ id: string; name: string; schedule?: string; room?: string }>;
  serverTime: number;
}

interface TeacherAttendanceSessionRow {
  id: string;
  classId: string;
  className: string;
  teacherId: string;
  teacherName: string;
  date: string;
  startTime?: string;
  schedule?: string;
  room?: string;
  sessionStatus: 'taught' | 'cancelled' | 'makeup';
  sessionKind: 'scheduled' | 'makeup' | 'cancelled';
  isVirtual: boolean;
  teacherAttendanceStatus: 'pending' | 'present' | 'absent';
  teacherAttendanceNote?: string;
  teacherAttendanceMarkedAt?: string;
  teacherAttendanceMarkedBy?: string;
  canMark: boolean;
  disabledReason?: 'future' | 'cancelled' | 'out_of_range';
}
```

## Mark API

Add a server API:

```http
POST /api/v1/teacher-attendance/mark
```

Body:

```ts
{
  classId: string;
  date: string;
  status: 'present' | 'absent';
  note?: string;
}
```

Rules:

- Only `admin` and `office` can mark.
- Reject future dates using Vietnam local date, matching student-attendance behavior.
- Reject invalid ISO dates.
- Reject sessions outside the class date range unless an existing `class_sessions` document for
  that date is `makeup`.
- Reject marking `cancelled` sessions.
- Resolve accepted substitute requests for the class/date before writing `teacherId`.
- Use a Firestore transaction to read class, session, and substitute state and then set/update the
  session.
- Write audit logs with user id, role, class id, teacher id, date, previous status, new status, and
  note presence.
- Touch realtime/read invalidation keys used by teacher attendance, payroll, and class detail.

Transaction behavior:

- If the session exists, update only teacher-attendance fields plus `teacherId` if substitute
  resolution requires it.
- If the session does not exist, create it as a scheduled taught session with attendance metadata.
- Preserve existing `status: 'makeup'` when marking a makeup session.
- Never convert `absent` into `cancelled`.

## UI

Create a dedicated admin/office page or tab named "Teacher Attendance".

Main layout:

- Weekly date navigation, defaulting to the current week.
- Filters for teacher, class, and status.
- Day-grouped session rows.
- Counters for total sessions needing action, pending, present, absent, and cancelled.

Each session row shows:

- Date and time.
- Class name.
- Room when available.
- Assigned teacher.
- Session kind: scheduled, makeup, or cancelled.
- Teacher attendance state: pending, present, or absent.
- Optional note indicator.

Actions:

- Mark present.
- Mark absent.
- Add/edit optional note.
- Disable actions for future sessions.
- Disable actions for cancelled sessions.

Teacher-facing payroll detail:

- No teacher-attendance page.
- Show read-only per-session status inside the teacher payroll detail.
- Use labels equivalent to confirmed, absent, pending, makeup, and cancelled.

## Payroll

Payroll remains a monthly calculation for the selected `YYYY-MM`.

From `TEACHER_ATTENDANCE_PAYROLL_START_DATE` forward:

- Count only sessions with `teacherAttendanceStatus === 'present'`.
- Do not count `absent`, `pending`, or `cancelled`.
- Count `makeup` only when present.
- Pay the teacher assigned to the session `teacherId`.
- Do not default missing session records to taught.

Before `TEACHER_ATTENDANCE_PAYROLL_START_DATE`:

- Preserve the current payroll behavior so historical payroll does not change unexpectedly.

Date boundaries:

- The payroll month always runs from the first day to the last day of the selected month.
- Fixed scheduled sessions are generated only inside class `startDate` and `endDate`.
- If a class ends mid-month, fixed schedule rows after `endDate` are not generated.
- Existing makeup sessions after `endDate` can still count in that payroll month when marked
  present.

## Error Handling

The mark API should return explicit errors:

- `403`: role cannot mark teacher attendance.
- `400`: invalid date, invalid status, future date, cancelled session, or outside class range.
- `404`: class not found.
- `409`: session state changed in a way that prevents marking, if detected during transaction.
- `500`: unexpected server failure.

The UI should keep optimistic updates conservative:

- Disable the row while a mark request is pending.
- Roll back the row state if the API fails.
- Show the server error message when available.

## Testing

Server/API tests:

- Teacher role cannot mark teacher attendance.
- Admin and office can mark `present` and `absent`.
- Future dates are rejected.
- Cancelled sessions are rejected.
- Marking a fixed scheduled virtual session creates `class_sessions`.
- Marking an existing makeup session preserves `status: 'makeup'`.
- Accepted substitute request assigns the substitute teacher id.
- Audit metadata includes old/new status and actor role.

Read-channel tests:

- Weekly read returns fixed scheduled rows.
- Weekly read returns existing makeup and cancelled sessions.
- Weekly read derives `pending` when no teacher-attendance status exists.
- Future and cancelled rows return `canMark: false`.

Payroll tests:

- From rollout date onward, only `present` sessions count.
- `absent`, `pending`, and `cancelled` do not count.
- Makeup present sessions count for the assigned teacher.
- Missing scheduled sessions no longer default to taught after rollout.
- Historical periods before rollout keep legacy behavior.
- A class ending mid-month only generates fixed schedule rows through `endDate`.

Frontend tests:

- Admin/office page renders week rows and counters.
- Filters by teacher, class, and status work.
- Future and cancelled actions are disabled.
- Payroll detail shows read-only attendance status for teachers.

## Rollout

Add a setting or environment-backed constant:

```ts
TEACHER_ATTENDANCE_PAYROLL_START_DATE = '2026-06-01';
```

This is the planned initial rollout date because the spec was created on 2026-05-31 and the new
payroll rule should start cleanly at the next payroll month. If deployment is delayed, this value
must be reviewed before implementation so a partial past month is not accidentally changed.

Rollout steps:

1. Deploy read and mark APIs.
2. Deploy admin/office teacher-attendance UI.
3. Deploy payroll changes with the rollout date.
4. Tell office/admin that future payroll requires marking teacher present.
5. Monitor pending sessions during the first payroll cycle.

## Non-Goals

- Do not replace student attendance.
- Do not remove substitute requests.
- Do not create a teacher self-check-in feature.
- Do not automatically cancel classes when a teacher is absent.
- Do not rewrite the full payroll module outside the logic needed for teacher attendance.
- Do not retroactively change payroll results before the rollout date.

## Open Implementation Notes

- Prefer reusing date helpers from class schedule/payroll code, but extract them into a shared module
  if needed to avoid duplicating schedule logic.
- The UI should use existing i18n patterns for Vietnamese labels.
- Existing class-session confirmation controls in the class attendance table should be removed or
  made read-only so teachers cannot self-confirm taught sessions.
