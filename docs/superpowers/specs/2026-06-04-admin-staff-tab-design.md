# Admin Staff Tab Design

## Purpose

Turn the admin dashboard's current teacher-only account tab into a staff account tab. Admins should be able to see and open profiles for all created staff accounts: teachers, office staff, accounting staff, and level managers.

## Current Context

- `src/pages/admin/AdminDashboard.tsx` has a top tab keyed as `teachers` and labelled from `t.tabs.teachers`.
- `src/pages/admin/hooks/useAdminDashboardData.ts` stores `registeredTeachers` and filters the dashboard projection to `teacher` and `level_manager`.
- `api/read/[channel].ts` reads admin dashboard users with `where('role', 'in', ['teacher', 'level_manager'])`, so office and accounting accounts never reach the admin tab.
- `src/pages/admin/tabs/TeachersTab.tsx` already opens `StaffProfileModal`, but all list labels still describe teachers.
- `src/components/admin/StaffProfileModal.tsx` only labels `teacher` and `level_manager`; every other role falls back to teacher.
- `src/components/CreateStaffModal.tsx` already supports `teacher`, `accounting`, `level_manager`, and `office`.

## User-Approved Design

Rename the top admin tab from "Teacher" / "Giáo viên" to "Staff" / "Nhân viên".

Keep the current two-column admin layout:

- Left column: authorized staff emails and revoked staff emails. The backing collections can stay `allowed_teachers` and `blocked_teachers` for now, but the visible copy should describe staff access.
- Right column: created staff accounts grouped into four sections:
  - Teachers signed in / Giáo viên đã đăng nhập
  - Office / Văn phòng
  - Accounting / Kế toán
  - Level managers / Quản lý cấp

Each staff row is clickable and opens a profile modal. Teachers keep assigned-class details. Level managers keep their managed-level badge and can show assigned classes if any exist. Office and accounting profiles should show role, name, email, and phone without implying they must have assigned classes.

## Data Flow

The admin dashboard read channel should include all internal staff roles:

- `teacher`
- `office`
- `accounting`
- `level_manager`

To avoid breaking current callers, the API can keep returning the existing `teachers` field while also adding a clearer `staff` field. The frontend should prefer `staff` when present and fall back to `teachers`.

The frontend hook should keep a true `registeredTeachers` list for teacher-only metrics, and add `registeredStaff` for the staff tab.

## Testing Requirements

- Backend read-channel test proves the users query includes all four staff roles and the projection returns teacher, office, accounting, and level manager accounts.
- Admin dashboard UI test proves the tab is labelled Staff, the four role sections render, and office/accounting rows can open a profile modal.
- Existing teacher profile modal test must continue to prove assigned class details render for teachers.
- Typecheck and focused Vitest runs should pass before implementation is considered complete.

## Out Of Scope

- Renaming Firestore collections `allowed_teachers` and `blocked_teachers`.
- Changing staff creation rules.
- Changing payroll logic.
- Adding staff search, pagination, or role filters beyond the four requested groups.
