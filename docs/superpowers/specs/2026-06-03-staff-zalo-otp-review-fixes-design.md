# Staff Zalo OTP Review Fixes Design

## Context

The staff Zalo OTP password reset flow is implemented and verified, but review found three follow-up issues:

- Staff self-reset changes Firebase Auth password without a critical audit log.
- Closing the staff forgot-password modal does not clear `staffForgotResetToken`.
- The success screen title always says the admin request was sent, even after a successful OTP password change.

The fix should stay narrow and preserve the working staff OTP and admin-request fallback flows.

## Approaches Considered

### Recommended: Minimal targeted fixes

Add audit logging directly inside the staff branch of `handleResetPasswordZalo`, clear the client reset token in the existing `Login.tsx` close handler, and use the existing modal `method` prop to choose the success title. This touches the fewest files and follows current code patterns.

### Alternative: Add richer staff reset status objects

Extend `StaffForgotStatus` with a `successKind` field such as `'admin_request' | 'password_changed'`, then render the title from that. This is more explicit, but it adds state shape churn for a simple two-branch modal that already receives `method`.

### Alternative: Extract shared staff reset audit helper

Create a helper shared between admin staff reset and Zalo OTP self-reset. This could reduce future duplication, but the current finding only needs one audit call and a helper would broaden the change.

## Design

Use the minimal targeted approach.

### Backend Audit

`api/auth/handlers/zaloOtp.ts` imports `writeCriticalAuditLog` and `getClientIp` from `api/lib/logging/auditLog.js`.

After staff password reset succeeds and the token is deleted, write a critical audit log:

- `userId`: staff uid from the reset token.
- `userRole`: `'staff'`.
- `action`: `'password_reset'`.
- `collection`: `'users'`.
- `documentId`: staff uid.
- `metadata`: `{ method: 'staff-zalo-otp', staffEmail }`.
- `ip`: `getClientIp(req)`.
- `userAgent`: request user-agent header.

The audit test will mock `writeCriticalAuditLog` and verify it is called after a successful staff reset.

### Client Token Cleanup

`src/pages/login/Login.tsx` already receives `setStaffForgotResetToken` from `useLoginHandlers`. The modal `onClose` cleanup should also call `setStaffForgotResetToken(null)` so a verified-but-abandoned flow cannot leave a stale client token in React state.

### Success Title

`src/components/StaffForgotPasswordModal.tsx` should render:

- admin request success title: existing `requestSent`.
- Zalo password reset success title: new `passwordChangedTitle`.

Use the existing `method` prop to choose the title. Add `passwordChangedTitle` to English and Vietnamese i18n. Update modal tests to cover both titles.

## Testing

- Extend `api/auth/zalo-otp.test.ts` to verify `writeCriticalAuditLog` for staff OTP reset.
- Extend `src/components/StaffForgotPasswordModal.test.tsx` to verify admin request and Zalo password-change success titles.
- Run the focused OTP and modal tests.
- Run `npm.cmd run typecheck`.
- Run `npm.cmd run build`.

## Self-Review

- No placeholders remain.
- Scope is one small follow-up plan for three review findings.
- The design keeps the current API and UI contracts intact.
