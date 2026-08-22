# Teachers Page Payroll Integration Design

## Goal

Show teacher payroll on the shared teachers page (`/teachers`) for admin only, and make office genuinely unable to read salary figures instead of only hiding them in the UI.

## Current Problem

`/teachers` (`src/pages/office/Teachers.tsx`) is open to `admin` and `office`. Payroll currently lives in a separate admin dashboard tab, gated client-side with `isAdmin &&` (`src/pages/admin/AdminDashboard.tsx:92-105`, `:188-196`).

That gate is cosmetic. Office already receives every teacher's salary today:

- `office-teachers-month` and `teacher-payroll-month` both delegate to one function, `readTeacherMonthPayload` (`server/api/read/handlers/readers.ts:268`).
- That payload always carries `salaryPerSession` on classes (`server/api/read/handlers/utils.ts:163`) and sessions (`:189`).
- `TEACHER_PAYROLL_MONTH_ROLES` includes `office` (`server/api/read/handlers/readers.ts:238-243`).
- An existing test asserts an office user receives `salaryPerSession: 150000` (`api/read/action.test.ts:2993`).

So an office account can read every class's salary from the network payload of the very page this feature targets.

Office also has a legitimate payroll-bearing feature: `/teacher-attendance` (admin + office, no role check anywhere in the page) exports "BANG CHAM CONG GIAO VIEN" with a `THANH TIEN` column and a `Tong` row (`src/pages/office/TeacherAttendance.tsx:305`, `src/lib/exports/teacherAttendanceReportExport.ts:4-12`). Cutting office off from salary necessarily changes that export.

The write path is already correct and stays untouched: `update-salary` returns 403 for non-admin (`server/api/classes/handlers/classOperationsHandlers.ts:88`).

## Decisions

1. Enforce salary visibility server-side, not in the UI.
2. Office keeps the attendance export but gets a money-free variant; admin keeps the full variant.
3. Payroll is rendered inline into the existing teachers-page sections, not as an embedded `TeacherPayroll` or a separate tab.
4. The admin dashboard payroll tab is removed; the all-teachers overview is recovered by a per-teacher salary badge in the teachers-page sidebar.

## Target Architecture

### Salary visibility rule

New shared module `shared/teacherSalaryVisibility.ts`, following the existing `shared/classVisibility.ts` pattern (server imports with a `.js` suffix, client imports without):

```ts
export function canViewTeacherSalary(role): boolean; // admin | accounting | teacher → true, office → false
```

`teacher` is safe here because `teacher-payroll-month` already scopes teachers to their own rows via `scopeTeacherToSelf` (`server/api/read/handlers/readers.ts:320-354`).

### Server enforcement — single choke point

Strip inside `readTeacherMonthPayload` (`server/api/read/handlers/readers.ts:268`), which both channels share, so one change closes both holes:

```ts
const includeSalary = canViewTeacherSalary(ctx.role);
// ...
classes: classDocs.map(teacherMonthClass).map(stripSalary(includeSalary)),
sessions: sessions.map(stripSalary(includeSalary)),
```

`stripSalary(false)` omits the `salaryPerSession` key entirely rather than zeroing it. `salaryPerSession` is already optional on `OfficeTeacherClass` and `OfficeTeacherSession` (`src/lib/api/officeTeachersApi.ts:36`, `:51`), so omission is type-compatible.

`office` stays in `TEACHER_PAYROLL_MONTH_ROLES`. Office still needs that channel for the money-free export; access is limited by removing the numbers, not by returning 403.

### Teachers page

`src/pages/office/Teachers.tsx` gains `useAuth()` for `isAdmin`, and builds a payroll view alongside the office view it already builds, joined on `teacher.uid`:

```ts
const payrollByTeacher = new Map(buildTeacherPayrollMonthView(data).rows.map((r) => [r.teacher.uid, r]));
```

Salary must come from `buildTeacherPayrollMonthView` (`src/lib/payroll/teacherPayrollMonth.ts`), never from a local `sessions × rate` multiplication. The payroll rule differs from the page's own `metrics.taught`: from `2026-06-01`, only sessions with `teacherAttendanceStatus === 'present'` count (`shouldCountSessionForPayroll` in `shared/teacherAttendance.ts`). Recomputing by hand would drift from accounting's `/payroll`.

Admin-only additions:

- A fifth `MetricCard`, "Tổng lương tháng", from `payrollRow.totalSalary`.
- A "Đơn giá" column in the class table with an inline edit control calling `PUT /api/v1/classes/update-salary`, mirroring the pattern in `src/components/finance/TeacherPayroll.tsx:127-157`.
- A monthly salary badge on each `TeacherRow` in the left sidebar.

Office renders none of these, and its payload carries no numbers to render.

Edge case to honour: `payrollRow.classes` only contains classes with at least one payable session, while the page's class table lists every class. A class with no payable session shows `0`, and its row is still rendered.

### Attendance export

`src/lib/exports/teacherAttendanceReportExport.ts` takes an `includeSalary` flag threaded through `buildTeacherAttendanceReportSheets` and `exportTeacherAttendanceReportWorkbook`. When `false`: drop `THANH TIEN` from the headers, drop the amount cell from each row, and drop the `Tong` row. The worksheet narrows from 7 columns to 6.

`src/pages/office/TeacherAttendance.tsx` adds `useAuth()` (it has no role check today) and passes `includeSalary={isAdmin}`.

### Admin dashboard cleanup

Remove the payroll tab button, its panel, and the lazy import from `src/pages/admin/AdminDashboard.tsx` (`:16-18`, `:92-105`, `:188-196`), and drop `'payroll'` from the `activeTab` union (`:27-29`). Remove the now-unused `TeacherPayroll` mock at `src/pages/admin/AdminDashboard.staffProfile.test.tsx:176`.

`src/components/finance/TeacherPayroll.tsx` is kept as-is. It still serves `/payroll` for accounting (`src/pages/accounting/Payroll.tsx`) and the teacher self-view (`src/pages/common/dashboard/TeacherDashboardView.tsx:506`). The accounting sidebar entry is untouched (`src/app/Sidebar.test.tsx:146` stays green).

## Rules

- Salary visibility is decided by `canViewTeacherSalary`, evaluated on the server against `ctx.role`.
- Client-side `isAdmin` checks are presentation only; they are never the sole control.
- Omit `salaryPerSession` when not visible; never send `0` as a stand-in, which would be indistinguishable from a genuinely unset rate.
- Office keeps read access to `teacher-payroll-month` and `office-teachers-month`, minus the salary fields.
- Salary totals always come from `buildTeacherPayrollMonthView`.
- The `update-salary` write path is unchanged and remains admin-only.
- `TeacherPayroll.tsx` is not modified by this work.

## Behaviour Change To Be Explicit About

`api/read/action.test.ts:2993` currently asserts that an office user receives `salaryPerSession: 150000`. This spec inverts that assertion: office must not receive the field. This is an intentional behaviour change, not a broken test, and the inverted test is the primary regression guard for the leak.

## Out Of Scope

- Refactoring or restyling `TeacherPayroll.tsx`.
- Changing payroll calculation rules.
- Changing who may edit salary.
- Access rules for any read channel other than the two named above.

## Verification

Run a focused command after each step before moving on:

- `shared/teacherSalaryVisibility` unit tests after adding the rule.
- `api/read/action.test.ts` after the server strip, covering office (absent), and admin, accounting, and teacher (present).
- `src/lib/exports/teacherAttendanceReportExport.test.ts` after the export split, covering both variants.
- `src/pages/office/Teachers.tsx` component tests after the UI work, asserting admin sees the salary card, rate column, and sidebar badge, and office sees none of them.
- `src/pages/admin/AdminDashboard.staffProfile.test.tsx` after the tab removal.
- Typecheck and build at the end.
