# Teacher Attendance Report Export Design

## Goal

Add an export report flow to the teacher attendance page. Office/admin users can choose a month and choose one teacher, several teachers, or all teachers, then download an Excel attendance/payroll worksheet.

## Scope

- Entry point: `src/pages/office/TeacherAttendance.tsx`.
- Output format: one `.xlsx` workbook.
- Workbook structure: one worksheet per selected teacher.
- Month range: day 1 through the real last day of the selected month.
- Report columns: `STT`, `NGAY`, `LOP`, `THU`, `GIO HOC`, `THANH TIEN`, `GHI CHU`.
- Explicitly excluded columns: lesson/period count and unit price per period.

## Data And Payroll Rules

The export must reuse the existing teacher attendance/payroll decisions instead of duplicating salary rules:

- Build the month data through the existing teacher month read channel and monthly schedule view.
- Count/export only shifts that satisfy the payroll rule in `shouldCountSessionForPayroll`.
- Use class/session salary per teaching session as the amount for each exported row.
- Cancelled sessions and teacher-absent sessions after the payroll attendance start date are not paid rows.
- The selected month is independent from the weekly range currently shown on screen.

## UX

The teacher attendance page gains an `Export report` button. Clicking it opens a compact modal with:

- Month input.
- Multi-select teacher checklist.
- `Select all` control.
- Export action with loading state.

When no teacher is selected, export is disabled. When export fails, show the existing toast error style. The downloaded file name includes the month.

## Error Handling

- API load/export failure shows a localized toast.
- Missing salary values export as `0`.
- Teachers with no paid rows still get a worksheet with the header and total row, so the selected set is explicit.

## Testing

- Unit-test report row generation for multi-teacher selection, monthly boundaries, paid-session filtering, amount lookup, and omitted period/unit columns.
- Component-test the modal controls and that the export button passes month and selected teacher IDs to the export helper.
