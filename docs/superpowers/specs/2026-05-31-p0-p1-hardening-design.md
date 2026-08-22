# P0/P1 Hardening Design

Date: 2026-05-31

## Scope

Fix the accepted P0/P1 audit findings while preserving explicit product decisions:

- Keep DOB fallback login for student/parent accounts that have not set a custom password.
- Do not handle `service-account-key.json` in this code change because it is already gitignored by project decision.
- Keep Knowledge Bank direct Firestore reads.
- Keep class end-date changes synchronized to evaluation dates by design.

This spec covers only the remaining high-priority hardening work: read API projections, transfer transaction correctness, parent dashboard truthful states, strict API response handling, accounting read scaling, and loadtest production guards.

## Approach

Use a contract-first hardening pass. Keep existing routes and UI entry points stable, but make risky data contracts explicit and fail safer on ambiguous states. Avoid broad rewrites or unrelated refactors.

## Design

### 1. Read API projection hardening

`api/read/[channel].ts` currently uses raw `docData()` in several responses. The change will add focused projection helpers near the existing read-channel projection helpers:

- assignment/submission projection helpers for `readAssignments`
- parent tuition helpers for ledgers, receipts, invoices
- class-detail helpers for attendance, evaluations, sessions, and reports

The routes remain unchanged. Staff/admin responses can retain richer data when needed. Student/parent responses should only include fields needed for UI display and normal workflow. Internal metadata such as proctoring, anti-cheat, audit, system processing, answer keys, and teacher-only notes should not be returned to student/parent consumers.

### 2. Transfer transaction correctness

`handleTransfer` in `api/students/[action].ts` will move finance-sensitive reads into the Firestore transaction. The transaction should read the current student document, old course ledgers, pending payment requests, and target ledger before writing derived transfer data.

The balance rollover, pending payment voiding, student update, class count delta, linked user sync, history creation, and target ledger creation should be derived from the transaction's current snapshots. The audit log and realtime touch calls remain after the transaction.

This prevents concurrent transfers from using stale ledger/payment snapshots.

### 3. Parent dashboard truthful states

Parent dashboard code should stop fabricating academic data.

- Ungraded submissions should not receive synthetic numeric scores such as `7.6` or `6.8`.
- Class average and rank should not be computed from the student's own score by subtracting constants.
- If true class average/rank is not available from backend data, UI state should expose `null`, `N/A`, or a localized “not available yet” label.
- `getAverageScore100` should handle evaluations missing `scores` without throwing.

The goal is to preserve a useful dashboard while avoiding misleading data.

### 4. Strict API response handling

`src/lib/api/apiClient.ts` should enforce a clearer JSON contract:

- If a response body includes `success`, it is successful only when `success === true`.
- `success === false`, `success: null`, `success: 0`, `success: ''`, and other non-true values should throw `ApiError`.
- Empty response bodies should not be treated as successful JSON responses by default.

If a future endpoint intentionally returns empty success, it should use an explicit option or separate helper rather than the default JSON API client behavior.

### 5. Accounting/read scale cap

`readAccountingStudents` already paginates students. Ledger fetching should stay scoped to the current student page and should have a fixed per-page cap instead of multiplying the requested student limit into potentially very large ledger reads.

This keeps the existing response shape but prevents a single accounting request from faning out into thousands or tens of thousands of ledger reads. Full ledger history can be handled by a dedicated paginated endpoint later if needed.

### 6. Loadtest production safety guard

Loadtest setup and mutating endpoint helpers should fail fast unless they are clearly running against an allowed non-production target.

The guard should check explicit loadtest intent such as `LOADTEST_ENV`, and, where available, project/base URL allowlists. Scripts that create users or post receipts/messages should refuse to run when the target appears to be production or the environment is not explicitly staging/test/loadtest.

This prevents accidental production data creation during local or CI loadtest runs.

## Error handling

- Projection helpers should coerce optional fields conservatively and omit unknown internal fields rather than throwing on missing optional values.
- Transaction changes should preserve current API error handling and return existing success/error shapes.
- API client strictness may surface previously hidden backend contract violations. Those should fail loudly as `ApiError` rather than becoming `null` data or false success.
- Loadtest guards should fail with actionable error messages explaining which environment variable or allowlist is required.

## Testing and verification

Verification should include:

- `npm run typecheck`
- `npm run lint`
- focused tests for read-channel projection behavior if existing tests are available
- transfer transaction tests or existing student API tests where available
- parent dashboard utility tests for missing `scores` and ungraded submissions where available
- loadtest guard tests or direct script checks where feasible

If the environment cannot run a test because of missing Firebase credentials/emulators, report that limitation clearly and rely on typecheck/lint plus targeted static verification.

## Non-goals

- Removing DOB fallback login.
- Modifying service-account-key handling.
- Moving Knowledge Bank reads behind server API.
- Changing the class end-date to evaluation-date synchronization behavior.
- Redesigning the full projection/read-model architecture.
- Proving 1000-user readiness through an actual load test in this change.
