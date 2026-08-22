# Profile Phone Zalo OTP Design

## Goal

Allow authenticated internal staff users to add or change their Zalo phone number from the Profile page. The new phone number must be verified by a Zalo OTP sent to that new number before it is saved to `users.phone`.

This phase applies only to internal staff roles:

- `admin`
- `teacher`
- `accounting`
- `office`
- `level_manager`

Parent phone management is out of scope for this phase.

## Current Context

The Profile page currently shows a single read-only field labelled like "Email / Phone", but the state only contains email. `UserProfile` already has an optional `phone` field, and staff forgot-password Zalo OTP now reads `users.phone` to validate staff identity.

The existing `/api/v1/students/update-profile` endpoint updates profile fields such as display name, avatar, and bio. It must not be extended to let clients write `phone` directly, because phone changes require OTP verification.

## Product Behavior

The Profile page separates email and phone ownership:

- Email is read-only and displayed as account identity.
- Staff phone is managed under the "Security & Password" tab.
- If a staff user has no phone, show: "Bạn chưa có số điện thoại, hãy thêm để dùng quên mật khẩu bằng Zalo OTP."
- If a staff user has a phone, show the current phone in a friendly local format and a "Change phone number" action.

The phone change flow is:

1. User enters a new phone number.
2. The app sends a Zalo OTP to the new phone number.
3. User enters the OTP.
4. The app shows "New phone number verified successfully" and a review step with the current phone and verified new phone.
5. User clicks "Confirm phone change".
6. Backend updates `users.phone`.

For staff with no existing phone, the same flow is used with "Add phone number" wording.

## Backend Design

Add a dedicated authenticated profile phone OTP handler module, for example `api/auth/handlers/profilePhoneOtp.ts`, with three actions exposed from `/api/v1/auth`:

### `request-profile-phone-otp`

Requires Firebase Auth token. Allowed roles are `admin`, `teacher`, `accounting`, `office`, and `level_manager`.

Request body:

```json
{ "phone": "0384072314" }
```

Behavior:

- Validate the input with `isValidVNPhone`.
- Normalize the phone to Zalo canonical format using `normalizePhoneVN`, for example `84384072314`.
- Do not require phone uniqueness across staff users.
- Rate limit by authenticated user: `profile_phone_otp:{uid}`, max 5 sends per 5 minutes.
- Generate a 6-digit OTP.
- OTP expires after 5 minutes.
- OTP allows at most 5 incorrect verification attempts.
- Store a pending OTP document keyed by `uid`, for example `profilePhoneOtps/{uid}`:
  - `uid`
  - `newPhone`
  - `otpHash`
  - `attempts`
  - `maxAttempts`
  - `verified: false`
  - `createdAt`
  - `expiresAt`
- Send the OTP through Zalo using the existing OTP ZNS template.

If Zalo configuration is missing or delivery fails, return an error and do not present the flow as successful.

### `verify-profile-phone-otp`

Requires Firebase Auth token.

Request body:

```json
{ "otp": "123456" }
```

Behavior:

- Load `profilePhoneOtps/{uid}`.
- Reject missing, expired, or locked pending OTP documents.
- Verify the OTP hash.
- Increment attempts on incorrect OTP.
- On success, set:
  - `verified: true`
  - `verifiedAt`
- Do not update `users.phone` in this step.

### `confirm-profile-phone-change`

Requires Firebase Auth token.

Behavior:

- Load `profilePhoneOtps/{uid}`.
- Require `verified === true`.
- Require the pending document to still be unexpired.
- In a transaction:
  - read `users/{uid}`
  - update `users/{uid}.phone = newPhone`
  - update `updatedAt`
  - delete the pending OTP document
- Write audit log metadata with masked phone values only:
  - `oldPhoneMasked`
  - `newPhoneMasked`
  - `role`
  - `method: "zalo-otp-profile-phone-change"`

After confirm, the new phone can immediately be used by the existing staff forgot-password Zalo OTP flow because that flow reads `users.phone`.

## UI Design

Update `src/pages/common/Profile.tsx`.

Personal info tab:

- Show full name.
- Show email as a separate read-only field.
- Remove the misleading combined "Email / Phone" label.
- Keep bio and visual preferences as they currently behave.

Security & Password tab:

- Add a "Zalo phone number" block.
- For users with a phone:
  - show the current phone in local display format
  - show "Change phone number"
- For users without a phone:
  - show the missing-phone warning
  - show "Add phone number"
- Only render the phone management block for internal staff roles in this phase.

Phone OTP modal or wizard states:

1. `input`
   - email read-only
   - new phone input
   - send OTP button
2. `otp`
   - show destination phone
   - 6-digit OTP input
   - resend after 60 seconds
   - text hint to contact admin if the user still cannot receive OTP
3. `verified`
   - success message
   - old phone review
   - new phone review
   - confirm phone change button
4. `success`
   - close modal and show Profile success status

All visible text should be added to `vi` and `en` i18n files.

## Validation And Formatting

Phone numbers are validated on both client and server. The server remains authoritative.

Database storage uses Zalo canonical phone format, for example `84384072314`. UI display can convert that to a friendly Vietnamese local format, for example `0384072314`.

## Error Handling

The UI should handle these states:

- invalid phone format
- Zalo configuration missing
- Zalo delivery failure
- rate limited request
- wrong OTP
- expired OTP
- too many OTP attempts
- pending OTP missing
- confirm attempted before verification
- unauthorized role

When OTP cannot be received, the UI should allow resend after cooldown and show guidance to contact admin if the issue continues. There is no admin manual-change fallback in this phase.

## Security Notes

- This is an authenticated profile flow, so the user does not need to re-enter email or current password.
- Phone updates must only happen through `confirm-profile-phone-change`.
- `update-profile` must not accept or write `phone`.
- OTP hashes, not OTP plaintext, are stored.
- Audit logs should mask phone numbers.
- Phone uniqueness is intentionally not enforced in this phase.

## Test Plan

Backend tests:

- request OTP succeeds for each allowed internal staff role
- request OTP rejects unauthorized roles
- request OTP rejects invalid phone values
- request OTP stores normalized `newPhone`
- request OTP calls Zalo with normalized phone
- request OTP respects rate limit
- verify rejects missing, expired, locked, and incorrect OTPs
- verify increments attempts on wrong OTP
- verify marks pending document as verified on correct OTP
- confirm rejects unverified or expired pending documents
- confirm updates `users.phone`, deletes pending OTP, and writes masked audit metadata
- confirm does not enforce phone uniqueness

Frontend tests:

- Profile shows email as read-only in personal info
- Profile shows phone management in security tab for internal staff roles
- staff without phone sees the missing-phone warning and add-phone action
- staff with phone sees current phone and change-phone action
- wizard moves through input, OTP, verified review, and success states
- resend cooldown and admin guidance render correctly
- error states render for invalid phone, OTP failure, and confirm failure
