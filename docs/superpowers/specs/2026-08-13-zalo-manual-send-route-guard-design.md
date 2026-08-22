# Zalo Admin Send Guard Fix Design

## Context

Production returns HTTP 500 for `POST /api/v1/zalo/admin-manual-send` before the Zalo handler runs. The student-identity route guard classifies every unknown write as `unclassified_write`, but the messaging inventory does not contain `admin-manual-send` or `admin-resend`. The guard therefore responds with `STUDENT_IDENTITY_MUTATION_UNCLASSIFIED` without throwing, which explains the status-only runtime log.

The concurrent browser exception comes from `useBlockDevToolGuard`: `isBlockedKeyboardShortcut` calls `event.key.toLowerCase()` without handling a missing or non-string `key`.

## Goals

- Allow admin manual Zalo sends to pass the student-identity guard because they do not mutate student-linked records.
- Keep admin resend protected by the student-identity maintenance guard because it may replay a student-linked notification.
- Make future unclassified write rejections visible in runtime logs without exposing request payloads or secrets.
- Prevent malformed or synthetic keyboard events from crashing the frontend guard.
- Add regression tests that fail on the current implementation and pass after the fixes.

## Non-goals

- Change Zalo provider payloads, retry behavior, authentication, rate limiting, or template validation.
- Change the student-identity maintenance policy for existing routes.
- Deploy or send a real Zalo notification as part of verification.

## Design

### Mutation inventory

Add two explicit messaging entries:

- `POST admin-manual-send` with disposition `staff_only`.
- `POST admin-resend` with the default disposition `student_mutation`.

This keeps the inventory fail-closed while expressing the different data risks of the two admin operations. Manual send can proceed during student-identity maintenance. Resend remains paused during maintenance because its source notification may be tied to a student.

### Guard diagnostics

Before returning the existing 500 response for `unclassified_write`, emit one structured warning containing only the route classification coordinates: surface, optional resource, action, and HTTP method. Do not log request bodies, authorization headers, phone numbers, template data, or other user data.

The public response remains compatible: status 500, code `STUDENT_IDENTITY_MUTATION_UNCLASSIFIED`, and the existing explanatory error message.

### Keyboard guard

Normalize the keyboard key defensively. Treat a non-string or missing `event.key` as an empty string. Such an event is not a blocked shortcut and must not navigate, call `preventDefault`, or throw.

Normal blocked shortcuts, including `F12`, modifier combinations, and `Ctrl/Cmd+U`, retain their current behavior.

## Data Flow After the Fix

1. Admin manual send reaches the route guard.
2. The inventory returns `staff_only`, so the maintenance check is skipped.
3. The existing `handleAdminZaloManualSend` flow performs validation, rate limiting, logging, provider delivery, and audit logging.
4. Admin resend reaches the same route guard, is classified as `student_mutation`, and performs the existing maintenance-state check before replaying a notification.
5. Any newly introduced write route that is absent from the inventory still fails closed, now with a structured warning in runtime logs.

## Testing

- Inventory tests assert that manual send is `staff_only` and does not require the student mutation guard.
- Inventory tests assert that admin resend is `student_mutation` and does require the guard.
- Route-guard tests assert that an unclassified write emits the sanitized structured warning while preserving the existing 500 response.
- Frontend hook tests dispatch a keydown-like event without a `key` and assert that it does not throw or navigate.
- Existing shortcut tests continue to verify blocked keyboard and context-menu behavior.
- Run targeted Vitest files, TypeScript type checking, and the broader relevant test suite. No production Zalo request is made.

## Success Criteria

- `POST /api/v1/zalo/admin-manual-send` is no longer rejected as an unclassified mutation.
- `POST /api/v1/zalo/admin-resend` remains subject to student-identity maintenance protection.
- Future unclassified writes produce a useful, privacy-safe runtime warning.
- A keyboard event without `key` cannot cause `Cannot read properties of undefined (reading 'toLowerCase')`.
- All targeted tests and type checking pass.
