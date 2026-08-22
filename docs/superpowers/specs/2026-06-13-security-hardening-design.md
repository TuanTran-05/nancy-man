# Full Security Hardening Design

Date: 2026-06-13

## Goal

Harden the internal EduTrack deployment against authenticated low-privilege users, leaked accounts, and manual API/Firebase access while preserving the existing product flows for admin, teacher, office, accounting, student, and parent users.

The security boundary is the backend and Firebase rules. Frontend route guards, hidden buttons, right-click blocking, and DevTools detection are not security controls.

## Approved Direction

Use a full hardening pass with focused, incremental changes:

- Close the confirmed Realtime Database authorization gap first.
- Minimize sensitive realtime payloads so deltas cannot become a shadow data API.
- Audit high-risk API groups for role checks, ownership checks, rate limits, upload validation, and safe error behavior.
- Add regression tests and an operational checklist so rules, secrets, and deployment steps stay aligned.

The preferred RTDB design is user-scoped delivery for sensitive or privileged deltas. Avoid `deltas/role/admin` in production code unless the project later adopts verified custom claims that RTDB rules can enforce directly.

## Threat Model

This hardening pass focuses on realistic risks for an internal education app:

- A student, parent, or staff user opens DevTools and manually subscribes to Firebase paths.
- A low-privilege account tries to read another class, another student, admin-only events, or finance data.
- A legitimate user calls API endpoints directly with edited request bodies.
- A bot or curious user spams login, OTP, password reset, AI generation, upload, or payment endpoints.
- A user guesses Storage paths or signed URL parameters.
- A webhook, Zalo notification action, or payment review endpoint is called by the wrong role.
- A future change accidentally reintroduces raw student reads or broad realtime access.

The pass does not attempt to protect against a fully compromised admin account, malicious server operator, Firebase Admin SDK credential theft, or a targeted penetration test by an advanced attacker with infrastructure access. Those risks require operational controls outside this code change.

## Current Security Posture

Several important controls already exist:

- API handlers use `verifyAuthToken` or `verifyAuthContext` for Firebase ID token verification.
- Token verification checks revoked tokens and blocked or inactive linked accounts.
- Firestore rules deny direct browser access to raw `/students` documents and credential collections.
- Storage rules keep student faces, knowledge-bank files, print request files, and catch-all paths server-only.
- Login, OTP, password reset, assignment submission, and AI generation already use rate limits in key paths.
- Tests already cover many auth, rules, safe-read, and API behaviors.

The confirmed gap is Realtime Database rules. `database.rules.json` currently allows any authenticated user to read:

- `deltas/class/$classId`
- `deltas/role/admin`

Server code pushes assignment and submission deltas to role and class recipients. Some submission deltas include student answer payloads and exam integrity metadata. This creates a path where a low-privilege authenticated user can manually subscribe to privileged or unrelated realtime data.

## RTDB Authorization Design

### User-Scoped Sensitive Deltas

Sensitive deltas should be delivered through `deltas/user/$uid/$topic`, because the existing RTDB rule can enforce `auth.uid == $uid` without cross-product Firestore lookups.

For admin broadcast use cases, server code should resolve the relevant admin users and push one event per admin user:

- Query `users` for active admin accounts.
- Exclude blocked users.
- Push `user:$adminUid` recipients instead of `role:admin`.
- Preserve direct `user:$teacherUid` and `user:$studentOrParentUid` delivery where already used.

The current user change that adds `.indexOn` under `deltas/user/$uid/assignments` and `deltas/user/$uid/submissions` is compatible with this design and should be preserved.

### Class Deltas

Class-scoped deltas should not be readable by every authenticated user.

There are two acceptable implementation paths:

- Preferred for sensitive topics: replace class delivery with user-scoped delivery to the relevant class members.
- Acceptable for non-sensitive topics only: keep class delivery only when payloads are non-sensitive invalidation events, not full documents.

For this pass, `assignments` and `submissions` should be treated as sensitive until tests prove the class payload is safe. Student and parent clients can still receive fresh UI by fetching initial data through authorized APIs or receiving user-scoped deltas.

### Role Deltas

`deltas/role/admin` should be removed from production delivery paths for sensitive topics. RTDB rules cannot safely determine admin role from Firestore user documents in the same way Firestore rules can. Custom claims may support role rules later, but this pass should not depend on a new claims migration.

The RTDB rules should deny role paths by default unless a later reviewed implementation creates a claim-backed role policy and tests it.

## Realtime Payload Design

Realtime deltas should be treated as notifications plus minimal projection, not as the source of truth for sensitive data.

For assignment deltas:

- It is acceptable to include display fields needed to insert or update a list item, such as id, title, description, due date, class id, type, attempts allowed, proctoring mode, teacher id, created/updated timestamps, and safe assessment display data.
- Private answer keys must remain in Firestore subcollections and should not appear in assignment deltas.

For submission deltas:

- Broad or multi-recipient deltas must not include `quizAnswers`, `assessmentAnswers`, `examIntegrity`, raw feedback meant for staff only, or private grading internals.
- User-scoped student/parent deltas may include only the fields needed by their own UI.
- Teacher/admin detail views should fetch full authorized records through existing APIs or Firestore rules rather than relying on broad delta payloads.

For removed events:

- The payload should remain empty or contain only metadata needed to remove the item from local state.

## API Hardening Design

The API review will focus on high-risk groups and preserve existing route names:

### Auth And Password Flows

Verify that public or semi-public auth actions have:

- Method checks.
- Rate limits with fail-closed behavior for identity-sensitive operations.
- Turnstile on login precheck and student login.
- Generic identity-failure responses for lookup and OTP flows where enumeration matters.
- Lookup challenge tokens or verified phone contexts before password reset.
- Admin or teacher ownership checks before approving or logging resets.

### Read Channels

Read channels should keep using `verifyAuthContext`, `assertActiveUser`, `requireRole`, and scoped projection helpers. Any channel returning student, finance, assignment, submission, attendance, or report data must enforce role and ownership on the server before serialization.

### Uploads And Signed URLs

Upload handlers should keep enforcing:

- Required auth role.
- Max file count and max file size.
- Allowed MIME and extension.
- Server-generated storage paths.
- Signed URL or Firebase token creation only after authorization.
- Cleanup on partial upload failure.

Student face and print request download paths must verify both the caller and the stored path before minting a signed URL.

### Payments And Finance

PayOS and finance endpoints should be audited for:

- Admin/accounting role gates on list, reconcile, resolve-review, reports, receipts, expenses, and ledgers.
- Parent/student scope checks on parent payment creation and payment status.
- Webhook verification and idempotency.
- No client-provided amount, student id, or status transition being trusted without server-side lookup.

### Zalo Actions

Zalo notification endpoints should be audited for:

- Role-specific gates, such as admin/accounting for payment notifications and admin/office for evaluation/rank flows where applicable.
- Deduplication or rate limiting where repeated sends can cause spam.
- Safe response bodies that do not expose unrelated student identity details.

### Error And Log Hygiene

API responses should return stable public error codes and avoid leaking stack traces, secrets, or raw provider responses. Server logs may include operational detail but should not log passwords, OTPs, private keys, payment secrets, or full uploaded content.

## Firebase Rules Design

### Firestore

Keep the current server-owned data model:

- `/students` direct browser reads remain denied.
- Credential collections remain denied.
- Writes for core business collections remain server-only.
- Existing role and ownership reads remain scoped.

This pass should add focused regression coverage instead of broad Firestore rule redesign.

### Storage

Keep Storage server-only for sensitive buckets and object prefixes:

- `student_faces`
- `knowledge_bank`
- `knowledge-bank`
- `print_requests`
- catch-all paths

Avatar reads may remain owner-scoped if the existing UI requires it.

### Realtime Database

RTDB rules should become deny-by-default for role and class paths unless a path has a clear enforceable rule. The baseline expected rules are:

- `deltas/user/$uid`: read only when `auth.uid == $uid`.
- `deltas/role/...`: denied by default.
- `deltas/class/...`: denied by default unless a later task introduces a tested, non-sensitive class invalidation policy.
- all delta writes: denied to clients.

## Testing Strategy

### RTDB Rules Tests

Add RTDB emulator tests that prove:

- Unauthenticated users cannot read any delta path.
- A user can read only `deltas/user/<ownUid>`.
- A user cannot read `deltas/user/<otherUid>`.
- A non-admin cannot read `deltas/role/admin`.
- An admin claim does not accidentally grant role access unless a claim-backed policy is intentionally implemented.
- Class paths are denied or restricted according to the implementation path chosen in the plan.

### Realtime Service Tests

Add tests around delta recipient generation and payload projection:

- Admin notifications are expanded to user recipients, not `role:admin`.
- Assignment deltas do not include private answer keys.
- Submission deltas sent to broad recipients do not include `quizAnswers`, `assessmentAnswers`, or `examIntegrity`.
- Removed events use empty or minimal payloads.

### API Regression Tests

Extend focused tests where existing suites already exist:

- Auth login, lookup, OTP, and password reset rate limits and 401/403 behavior.
- Read channels with low-privilege users attempting cross-student or cross-class reads.
- Upload endpoints reject wrong role, wrong MIME, oversized file, missing file, and path tampering.
- PayOS and finance endpoints reject unauthorized roles and invalid ownership.
- Zalo endpoints reject wrong roles and rate-limit/dedupe repeated sends where implemented.

### Firebase Rules Tests

Keep running Firestore rules tests through `npm run test:rules`. Add Storage and RTDB rule test scripts if they are not currently wired into `package.json`.

### Verification Commands

The implementation should aim to run:

- `npm run typecheck`
- `npm run test`
- `npm run test:rules`
- RTDB rules tests once added
- Storage rules tests once wired
- targeted API tests touched by the plan

If emulator or credential availability blocks a command locally, the final report must state the blocker and list the tests that were still run.

## Operational Checklist

Create or update a short security checklist covering:

- Required production env vars: Firebase Admin, Firebase RTDB URL, `APP_URL`, Turnstile, `LOOKUP_CHALLENGE_SECRET`, `OTP_PEPPER`, PayOS, Zalo, Gemini.
- Rules deployment order for Firestore, Storage, and RTDB.
- Secret rotation steps after any suspected leak.
- User role review for admin/accounting/office/teacher/level-manager accounts.
- Confirmation that Firebase web config is public but Admin SDK credentials are not.
- Pre-deploy commands for typecheck, tests, and rules tests.
- Post-deploy smoke checks for auth, read channels, upload signed URLs, payment status, Zalo sends, and realtime updates.

## Error Handling

- RTDB authorization failures should surface to clients as realtime subscription errors, not silent exposure.
- Client streams should continue working through initial API loads even when a realtime path is denied during rollout.
- API guards should preserve existing response shapes where possible, using 401 for missing/invalid auth, 403 for insufficient role/scope, 405 for wrong method, 429 for rate limits, and 400 for invalid payloads.
- Failed background delta delivery should log server-side errors but must not make the primary Firestore write unsafe.

## Rollout

### Phase 1: Close Confirmed RTDB Gap

Lock down RTDB role/class paths, migrate sensitive admin/class delta delivery to user-scoped recipients, and add RTDB rule tests.

### Phase 2: Minimize Delta Payloads

Project assignment and submission deltas to safe fields and add tests that prevent sensitive fields from returning.

### Phase 3: Audit High-Risk APIs

Review and patch auth, read, upload, finance, PayOS, and Zalo routes with targeted tests.

### Phase 4: Rules And Operational Hardening

Add missing Storage/RTDB test scripts, update docs, and run the security verification suite.

## Non-Goals

- Adding anti-F12, right-click blocking, or browser obfuscation as security controls.
- Replacing Firebase with a different backend.
- Removing all realtime behavior.
- Rewriting the entire API routing structure.
- Migrating all role data to custom claims in this pass.
- Removing student or parent login.
- Running a full external penetration test.

## Acceptance Criteria

- Authenticated low-privilege users cannot read admin RTDB deltas.
- Users cannot read another user's RTDB delta path.
- Class RTDB paths are denied or restricted to a tested safe policy.
- No production code pushes sensitive deltas to `role:admin`.
- Broad assignment/submission deltas do not include answer keys, submitted answers, or exam integrity metadata.
- High-risk API groups have explicit role, ownership, method, and rate-limit checks documented or tested.
- Firestore and Storage rules keep direct sensitive reads and writes server-only.
- Security checklist documents required env vars, rule deploy order, and pre/post-deploy verification.
- Typecheck and targeted tests pass, or any blocked verification is reported with a concrete reason.
