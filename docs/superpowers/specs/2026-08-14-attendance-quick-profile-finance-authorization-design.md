# Attendance Quick Profile Finance Authorization

## Problem

The attendance student quick-profile API currently returns aggregate tuition data to both `admin` and `office` users. The profile panel renders the finance section whenever that data is present. This contradicts the product authorization rule that only administrators may view tuition paid or outstanding amounts.

## Authorization rule

- `admin`: may receive and view aggregate tuition information.
- `office`: may view the student's profile and attendance summary, but must not receive or view tuition information.
- `teacher`: may view the student's profile and attendance summary when class access permits, but must not receive or view tuition information.

This change applies specifically to the student quick profile opened from a class Attendance tab. It does not change permissions on other pages or APIs.

## Design

### Server-side data minimization

`readAttendanceStudentQuickProfile` will build and attach the optional `finance` field only when `ctx.role === 'admin'`. Office and teacher responses will omit the field entirely. The server remains the authoritative authorization boundary, so restricted financial values are never sent to those clients.

The existing response shape remains compatible because `finance` is already optional. No migration or persisted-data change is required.

### Client-side defense in depth

`ClassAttendanceStudentQuickProfile` will derive an explicit boolean permission from the authenticated profile role and pass it to `AttendanceStudentQuickProfilePanel`. The panel will render the finance section only when both conditions hold:

1. The viewer has permission to see finance.
2. Finance data exists in the response.

The reusable panel will receive a capability boolean rather than interpreting role names itself. This keeps role policy in the authenticated container and prevents accidental display if a future server regression includes finance data in a restricted response.

### Unchanged behavior

- Office and teacher users retain access to permitted identity, status, contact, and current-course attendance information.
- Admin users retain the existing aggregate paid and outstanding tuition display.
- Class-access checks, edit/status actions, loading behavior, and error handling remain unchanged.

## Verification

Tests will be written before the production change and must demonstrate the current failure first.

- Server test: Admin receives the expected aggregate `finance` object.
- Server test: Office receives no `finance` field.
- Server test: Teacher receives no `finance` field.
- Component/integration test: Office does not render the finance heading, paid amount, or outstanding amount even if injected data contains finance.
- Component/integration test: Admin still renders authorized finance data.
- Regression verification: relevant focused tests, TypeScript checking, and the broader test suite pass.

## Acceptance criteria

1. Opening a student's quick profile from Attendance as Office shows profile and attendance information without any tuition section or monetary values.
2. The Office quick-profile network response contains no `finance` property.
3. Teacher behavior remains finance-free.
4. Admin behavior remains unchanged and continues showing aggregate tuition paid and outstanding amounts.
