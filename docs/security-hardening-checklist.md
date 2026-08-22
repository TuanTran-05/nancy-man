# Security Hardening Checklist

Updated: 2026-08-19

## Required Production Environment Variables

- VPS/runtime: `NODE_ENV`, `DEPLOYMENT_STAGE`, `APP_URL`, `PUBLIC_BASE_URL`, `INTERNAL_API_BASE_URL`
- PostgreSQL: `DATABASE_URL`, pool/time-out settings, backup directory, and retention
- Object storage: `STORAGE_BACKEND`, `STORAGE_LOCAL_ROOT`, `STORAGE_SIGNING_SECRET`
- Student/parent lookup and OTP: `LOOKUP_CHALLENGE_SECRET`, `OTP_PEPPER`
- Cloudflare Turnstile: `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAME`
- PayOS: `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`, `PAYOS_RETURN_URL`, `PAYOS_CANCEL_URL`
- Zalo: all Zalo OA provider credentials and template IDs used by the deployed notification flows
- Gemini: `GEMINI_API_KEY`

## Deployment Order

1. Create and verify a PostgreSQL backup.
2. Apply reviewed migrations and run the schema/data verification scripts.
3. Build and activate the VPS release.
4. Verify health, authorization, uploads, scheduled jobs, and rollback readiness.

## Pre-Deploy Verification

Run these commands before production deploy:

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:vps
npm.cmd run build:vps
```

## Post-Deploy Smoke Checks

- Login as admin, teacher, parent, and student.
- Confirm parent/student cannot see another student's dashboard, assignments, submissions, tuition, or payment status.
- Confirm admin/teacher assignment updates refresh through the API polling path.
- Upload a knowledge-bank file, print request file, profile image, student face image, assignment media file, and assignment answer file.
- Confirm signed URL endpoints return URLs only after authorization.
- Create a PayOS payment link as a linked parent and verify status as the same parent.
- Confirm an unrelated parent/student receives 403 for the same payment status.
- Send one allowed Zalo notification and confirm duplicate/rate-limit behavior for repeated sends.

## Secret Rotation

- Rotate PostgreSQL, object-storage signing, and VPS access credentials after any suspected repository or machine compromise.
- Rotate PayOS and Zalo credentials after provider dashboard compromise or webhook abuse.
- Rotate `LOOKUP_CHALLENGE_SECRET` and `OTP_PEPPER` after any OTP or reset-flow secret exposure.
- After rotation, run login, OTP, password reset, PayOS webhook, and Zalo smoke checks.

## Role Review

Review `users`, `allowed_teachers`, and `blocked_teachers` before each production launch:

- Admin accounts are limited to current operators.
- Accounting accounts are limited to finance users.
- Office accounts are limited to staff who need admissions and academic operations.
- Teacher accounts have no stale blocked access.
- Student and parent linked accounts point to active student records.
