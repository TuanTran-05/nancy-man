# Remove Accounting Students Navigation

## Goal

Remove the misleading **Students** entry from the accounting sidebar. Accounting staff should use the finance workspace as their student directory while retaining access to an individual student's profile from that workspace.

## Current Behavior

- The accounting sidebar links **Students** to `/students`.
- When an accounting user opens `/students`, the route immediately redirects to `/tuition?tab=students`.
- This makes the sidebar appear to offer a separate student page even though accounting users are taken to the finance workspace.

## Design

### Navigation

Remove the `/students` item only from `accountingNavSections` in `Sidebar.tsx`.

Do not change the student navigation available to admin, teacher, or office roles.

### Route Compatibility

Keep the existing accounting redirects from `/students` and `/accounting/students` to `/tuition?tab=students`. These redirects preserve old bookmarks and external links without displaying a separate accounting student directory.

Keep accounting access to `/students/:studentId`. The finance workspace may continue linking to individual student profiles, where accounting users can view the permitted overview and finance information.

### Authorization and Data

This change does not alter backend permissions, finance data, or student-profile field visibility. Existing route guards and role-specific profile behavior remain unchanged.

## Testing

Update the sidebar component test to verify that an accounting user:

- can see the **Finance** and **Payroll** links;
- cannot see a **Students** navigation link; and
- retains the existing accounting navigation items.

Keep the existing route tests that verify legacy list routes redirect to the finance workspace and individual student-profile routes remain available.

## Acceptance Criteria

1. The accounting sidebar contains no **Students** entry.
2. Admin, teacher, and office student navigation is unchanged.
3. Accounting users opening an old student-list URL reach the finance workspace.
4. Accounting users can still open an individual student profile from the finance workspace.
5. Relevant tests, type checking, and the production build pass.
