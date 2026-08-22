# Zalo OA Manual Send Runbook

## Required Zalo permissions

The app connected to the EduTrack OA must have these ZBS permissions:

- `Quản lý Message Template` for template list and detail APIs.
- `Gửi tin qua số điện thoại` for the provider send API.

If template-management permission is absent, EduTrack displays the configured safe-template fallback and a warning. OTP and staff-credential Template IDs remain excluded.

## Production smoke test

1. Sign in with an EduTrack `admin` account and open `/admin/zalo-oa`.
2. Confirm the OA status is connected and the `Gửi thủ công` panel is enabled.
3. Select a low-risk customer-care template and verify its required variables appear.
4. Enter the phone number of an authorized test recipient, review every value, then confirm once.
5. Expand the new history row and verify `Template ID`, `Tracking ID`, normalized phone, variables, admin name, and provider message ID.
6. Use `Gửi lại`, enter a reason, and verify the new row contains `resendOf`, `resendReason`, and the same stored variables.

## Error diagnosis

- `-115`: check the ZBS Account balance.
- `-117` or `-138`: verify the OA authorized the app for the selected template or API group.
- `-124`: refresh the OA authorization and confirm the stored refresh token is current.
- `-131`: the template is not approved; use an `ENABLE` template.
- `-139`: the recipient refused this message type.
- `-144` or `-147`: the OA or template reached its daily quota.
- `-1121`, `-1122`, or `-1124`: compare the submitted variable with `listParams`, including length and format.

## Firestore evidence

Manual attempts write one `zalo_notifications` document before contacting Zalo. A healthy completed record has `type=manual`, `source=admin_manual`, `status=sent|failed`, `payloadCaptured=true`, a version-1 `payloadSnapshot`, `trackingId`, and `sentBy`. Failed provider calls also store the numeric `providerErrorCode` returned by Zalo.

A record left at `status=sending` means the process ended after the pre-send log was created and before the provider result update completed. Search application logs by its `trackingId` before deciding whether to resend.

## Rollback

Revert the page-integration and endpoint commits, deploy, and leave existing snapshot fields in Firestore. They are additive and ignored by the previous history projection. Do not delete `zalo_notifications` or `audit_logs` during rollback.
