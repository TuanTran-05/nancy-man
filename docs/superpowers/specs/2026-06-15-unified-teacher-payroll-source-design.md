# Unified Teacher Payroll Source Design

## Goal

Make teacher payroll use one source of truth across teacher self-view, accounting/admin payroll views, and office/export reports.

## Current Problem

Teacher payroll currently has two aggregation paths:

- `src/components/finance/TeacherPayroll.tsx` fetches Firestore collections directly and calculates payroll locally.
- `src/lib/exports/teacherAttendanceReportExport.ts` reads `office-teachers-month` data and builds report rows separately.

Both paths read the same underlying attendance data, but duplicated calculation creates risk that the payroll screen and exported attendance/payroll report diverge.

## Target Architecture

Create one shared monthly payroll view helper and one read API channel:

- Shared helper: `src/lib/payroll/teacherPayrollMonth.ts`
- Read API channel: `teacher-payroll-month`
- Client API: `src/lib/api/teacherPayrollApi.ts`

The shared helper accepts monthly teacher/class/session/substitute data and returns:

- Teacher totals.
- Class totals per teacher.
- Paid shift detail rows for exports and drill-down views.
- Daily schedule detail for the payroll calendar.

Consumers:

- `TeacherPayroll.tsx` reads `teacher-payroll-month` and renders from the shared view.
- `teacherAttendanceReportExport.ts` receives or builds from the same shared view rows.
- Admin/accounting/teacher role visibility is enforced by the read API.

## Rules

- Month range is day 1 through the real last day of the selected month.
- From `2026-06-01`, a session counts only when `teacherAttendanceStatus` is `present`.
- `pending`, `absent`, and `cancelled` rows do not count as paid.
- Before `2026-06-01`, legacy scheduled/taught behavior is preserved.
- Accepted substitutes are credited to the effective substitute teacher.
- Salary amount uses `session.salaryPerSession` first, then `class.salaryPerSession`, then `0`.
- Teacher role can only read their own payroll rows.
- Accounting and admin can read all payroll rows.
- Admin keeps salary edit capability; accounting remains read-only.

## Verification

Every implementation step must run a focused verification command before moving to the next step:

- Helper tests after helper changes.
- API tests after channel changes.
- Component tests after UI/data-source changes.
- Export tests after export migration.
- Typecheck/build after cleanup.
