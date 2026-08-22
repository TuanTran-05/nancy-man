# Attendance Student Quick Profile Design

## Status

Approved on 2026-08-13.

## Problem

The Attendance tab in a class detail page shows student names as static text. A user who needs to inspect a profile, edit student information, or change enrollment status must leave the class, open Students, search for the same person, and start the action there.

The change adds those actions to the attendance roster while preserving the compact attendance grid.

## Scope

The feature provides three actions from Attendance:

- View a short student profile in a panel without leaving the class page.
- Edit student information with the existing student form modal.
- Change enrollment status with the existing status modal.

The panel adds two summaries:

- Attendance for the current course of the open class, shown as attended sessions over total course sessions.
- Tuition paid and outstanding across every course belonging to the student. These values are available to Admin and Office only.

Transfer, deletion, full academic history, detailed ledger rows, receipts, evaluations, and report tabs remain outside this panel.

## User Experience

### Entry point

The name in the sticky student column becomes a semantic button. Hover and keyboard focus styling indicate that it is interactive. The row receives no extra icon, overflow menu, or permanent action buttons.

Selecting a name opens a panel from the right and leaves the attendance table visible behind it. On narrow screens the panel occupies the available screen width. Closing it restores focus to the name that opened it.

The panel closes through its close button, the Escape key, or the overlay. Focus remains trapped inside the panel while it is open.

### Panel content

The header contains the student's face image or fallback initials, name, school code, current class, and enrollment status.

The profile section shows date of birth, gender, contact information, and status note. Empty optional values use a neutral missing-value label rather than a fabricated value.

The attendance section shows:

- Attended sessions: `present + late` within the current course enrollment.
- Total sessions: all scheduled and makeup sessions for the current course, including future sessions, excluding holidays and cancelled sessions.

The finance section shows `totalPaid` and `totalOutstanding` summed across every course ledger for the student. It is rendered for Admin and Office. Teacher responses omit the finance object, so hiding the section in the browser is not the security boundary.

Two actions appear at the bottom: Edit student and Change status. They open the existing shared modals. Archived or paused classes keep the panel read-only and hide both actions.

### Loading and errors

The panel opens immediately with a skeleton. Loading the summary does not disable attendance controls or shift the grid.

If the selected student changes before an earlier request finishes, the earlier response is ignored. A failed request displays an inline error and a Retry button inside the panel. The attendance page remains usable.

Unknown values stay unknown:

- If the current course schedule cannot be resolved, attendance displays "Insufficient data".
- If the authorized response has no ledger evidence, finance displays "No tuition data".
- A confirmed numeric zero displays `0 ₫`.

## Component Boundaries

`ClassAttendanceTab` owns only the roster interaction. It receives `onOpenStudent(student)` and calls it from the name button.

`ClassDetail` owns the selected student, panel visibility, role-aware action availability, summary refresh, and shared student action modals. This keeps the attendance grid independent of profile reads and mutations.

A new `AttendanceStudentQuickProfilePanel` renders the summary states and exposes callbacks for close, retry, edit, and status change. It does not calculate attendance or money.

The existing `useStudentActionModals` controller remains the only client path for student edits and status changes. The hook receives lazily loaded class and teacher reference data when an edit action needs it.

## Summary Read Model

Add a dedicated authenticated read channel for the panel. The request contains `studentId` and `classId`. The server resolves a retired student identifier to the canonical profile before reading dependent records.

The response has this shape:

```ts
type AttendanceStudentQuickProfileResponse = {
  student: {
    id: string;
    name: string;
    studentId: string;
    classId: string;
    dob: string;
    contact: string;
    gender?: 'male' | 'female' | 'other';
    enrollmentStatus?: EnrollmentStatus;
    statusNote?: string;
    faceImage?: string;
    faceImageStoragePath?: string;
  };
  class: {
    id: string;
    name: string;
  };
  attendance: {
    attendedSessions: number;
    totalSessions: number;
  } | null;
  finance?: {
    hasLedgerData: boolean;
    totalPaid: number;
    totalOutstanding: number;
  };
  generatedAt: string;
};
```

The response deliberately excludes raw attendance rows, ledger rows, receipts, parent credentials, login hashes, transfer history, and deletion metadata.

## Authorization

The endpoint accepts Admin, Office, and Teacher.

`assertClassAccess(db, ctx, classId, 'read')` verifies access to the open class. The canonical roster is then checked to confirm that the requested student belongs to that class or has a course enrollment segment for the current class course. A Teacher outside the class receives the same not-found response used by existing student profile reads.

Admin and Office receive the finance object. Teacher never receives it. The mutation routes used by Edit student and Change status retain their own role checks.

Accounting is not added to the Attendance class page or this endpoint because the page is outside that role's navigation and academic scope.

## Attendance Calculation

The current course is the current term of the class opened in `ClassDetail`. Its range and schedule come from the canonical class term data and the student's canonical course enrollment.

The server uses the existing session-generation rules already used by the student report:

1. Generate scheduled dates for the full course range.
2. Remove class holidays and cancelled sessions.
3. Add makeup sessions that fall inside the course range.
4. Apply the student's join and end boundaries when deciding whether a session belongs to the enrollment.
5. Count `present` and `late` as attended. `absent`, `on_leave`, `unmarked`, and `not_enrolled` do not increment attended sessions.

`totalSessions` represents the complete course for that enrollment, including future eligible dates. If the class uses marked-only attendance and lacks a reliable complete schedule, `attendance` is `null` rather than a misleading total.

## Finance Calculation

The finance summary reuses the accounting projection rules and shared money helpers. It sums `paidTotal` and `ledgerRemaining` across all course ledgers for the canonical student profile, including archived courses.

`hasLedgerData` distinguishes an actual zero balance from a student who has no ledger rows. The endpoint does not infer tuition from class fees and does not expose individual ledgers to Office.

If the accounting projection is available and current, the read may use its `totalPaid` and `totalOutstanding`. A projection health failure must fall back to the canonical ledger calculation or return the finance section as unavailable; it must not return stale totals as current values.

## Mutation and Refresh Flow

Edit student and Change status open the current shared modals. A successful mutation triggers the existing student invalidation channel and refreshes the open summary.

If the new status removes the student from the active Attendance roster, the panel closes after the class roster refresh. Examples include Dropped, Promoted, and Archived. On Leave remains subject to the Attendance tab's existing "show on leave" filter.

Failed mutations keep the modal and entered values open. The panel does not apply optimistic profile or finance changes.

## Accessibility and Responsive Behavior

The student name is a native button with an accessible label that includes the student's name. The panel uses dialog semantics, an accessible title, focus trapping, Escape handling, and focus restoration.

Icon-only controls have accessible labels. Skeleton and retry states are announced without repeatedly interrupting screen readers. The desktop side panel becomes a full-width sheet on small screens, with actions remaining reachable without horizontal scrolling.

## Testing

Server tests cover:

- Admin and Office receiving only aggregate finance fields.
- Teacher receiving no finance property.
- Teacher access to an owned class and refusal outside that class.
- Canonical student ID resolution.
- Present and late counting as attended.
- Holidays, cancelled sessions, makeup sessions, join dates, and end dates.
- Multi-course paid and outstanding totals.
- No-ledger versus zero-balance responses.
- Marked-only or incomplete schedule returning `attendance: null`.

Client tests cover:

- Clicking a student name opens the panel for that student.
- Loading, success, error, retry, and stale-response behavior.
- Finance visibility for Admin and Office and its absence for Teacher.
- Edit and status buttons calling the shared modal controller.
- Refresh after a successful mutation.
- Closing the panel when the selected row leaves the filtered roster.
- Read-only behavior for paused and archived classes.
- Keyboard opening, Escape closing, and focus restoration.

The delivery gate runs the focused server and component tests, the relevant regression suite, and the production build.

## Out of Scope

This change does not embed the full Student Profile page, create inline editing inside the panel, expose detailed tuition transactions to Office, add transfer or delete actions, change attendance toggle behavior, or change the Students page.
