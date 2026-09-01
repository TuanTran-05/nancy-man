# Ops Canonical Auth and User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the entire Ops Console browser surface to canonical PostgreSQL authentication and add owner-controlled user creation, enrollment, role, lock, recovery, and permanent revoke.

**Architecture:** Extend the existing `/api/v1/auth` session/TOTP system and append-only audit ledger; do not teach the canonical API to trust legacy cookies. During cutover, the canonical API calls a narrow HMAC-authenticated loopback adapter for monitoring data that still resides in SQLite, while all browser authorization is canonical.

**Tech Stack:** Node.js 22.22+, TypeScript 5.8, Express 5, PostgreSQL, Drizzle schema declarations, Zod, React 19, Vitest, Testing Library, Playwright, Nginx, systemd.

**Spec:** `docs/superpowers/specs/2026-08-31-ops-variables-access-management-design.md`

## Global Constraints

- The browser uses only the canonical `__Host-ops-session` cookie and `/api/v1` authentication.
- `tuan.dev` is enrolled as `ops_owner`; `ops-admin` is enrolled as `ops_maintainer` before legacy login removal.
- New user links are single-use HTTPS links with a 24-hour lifetime; clear tokens are returned once and never logged.
- Owner administrative lock requires password/TOTP re-enrollment; failed-login cooldown remains a separate automatically expiring throttle.
- Revoke is terminal. Self mutation and final-owner demotion/lock/revoke fail inside the database transaction.
- Account mutation requires canonical session, strict Origin, CSRF, `accounts:write`, and a fresh password+TOTP `accounts_write` grant.
- No password, TOTP, session token, enrollment token, or reversible credential fragment may enter logs, audit metadata, URLs other than the one-time enrollment response, or browser persistence.
- Follow TDD: observe every new test fail for the intended reason before implementation, then run the narrow test and the package regression suite before committing.
- Do not deploy or modify production accounts while executing this code plan; production enrollment is a separately approved runbook action.

---

## File Structure

### Create

- `packages/db/migrations/0014_ops_account_administration.sql` — account lock split and account-event persistence.
- `packages/db/migrations/0015_ops_secret_elevations.sql` — typed, session-bound step-up grants shared with later Variables work.
- `packages/db/src/accountAdministrationMigration.test.ts` — migration contract tests.
- `apps/api/src/modules/auth/stepUpService.ts` — password+TOTP grant issuance and consumption.
- `apps/api/src/modules/auth/stepUpService.test.ts`
- `apps/api/src/modules/auth/postgresStepUpRepository.ts`
- `apps/api/src/modules/auth/postgresStepUpRepository.test.ts`
- `apps/api/src/modules/accounts/accountService.ts` — lifecycle invariants and one-time-link orchestration.
- `apps/api/src/modules/accounts/accountService.test.ts`
- `apps/api/src/modules/accounts/postgresAccountRepository.ts`
- `apps/api/src/modules/accounts/postgresAccountRepository.test.ts`
- `apps/api/src/modules/accounts/accountRoutes.ts`
- `apps/api/src/modules/accounts/accountRoutes.test.ts`
- `packages/contracts/src/legacyMonitoringProtocol.ts` — canonical-to-legacy loopback request signature.
- `packages/contracts/src/legacyMonitoringProtocol.test.ts`
- `apps/api/src/modules/monitoring/legacyMonitoringClient.ts`
- `apps/api/src/modules/monitoring/legacyMonitoringClient.test.ts`
- `apps/api/src/modules/monitoring/monitoringRoutes.ts`
- `apps/api/src/modules/monitoring/monitoringRoutes.test.ts`
- `apps/web/src/server/http/internalCanonicalRoutes.ts`
- `apps/web/src/server/http/internalCanonicalRoutes.test.ts`
- `apps/web/src/web/routing.ts`
- `apps/web/src/web/components/OpsShell.tsx`
- `apps/web/src/web/pages/OverviewPage.tsx`
- `apps/web/src/web/pages/UsersPage.tsx`
- `apps/web/src/web/pages/UsersPage.test.tsx`
- `apps/web/src/web/components/RevokeUserDialog.tsx`
- `apps/web/src/web/components/RevokeUserDialog.test.tsx`
- `docs/runbooks/ops-canonical-auth-cutover.md`

### Modify

- `packages/db/src/schema/auth.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/migrationManifest.ts`
- `packages/db/src/migrationManifest.test.ts`
- `packages/security/src/sessions.ts`
- `packages/security/src/sessions.test.ts`
- `packages/security/src/mfa/enrollmentToken.ts`
- `apps/api/src/modules/auth/authService.ts`
- `apps/api/src/modules/auth/authService.test.ts`
- `apps/api/src/modules/auth/authRoutes.ts`
- `apps/api/src/modules/auth/authRoutes.test.ts`
- `apps/api/src/modules/auth/postgresAuthRepository.ts`
- `apps/api/src/modules/auth/postgresAuthRepository.test.ts`
- `apps/api/src/modules/auth/totpEnrollment.ts`
- `apps/api/src/modules/auth/totpEnrollment.test.ts`
- `apps/api/src/modules/auth/postgresTotpEnrollmentRepository.ts`
- `apps/api/src/modules/auth/postgresTotpEnrollmentRepository.test.ts`
- `apps/api/src/modules/auth/sessionAuthorization.ts`
- `apps/api/src/modules/auth/sessionAuthorization.test.ts`
- `packages/db/src/repositories/opsSessions.ts`
- `packages/db/src/repositories/opsSessions.test.ts`
- `apps/api/src/index.ts`
- `apps/api/src/runtime/runtimeConfig.ts`
- `apps/api/src/runtime/runtimeConfig.test.ts`
- `apps/api/src/runtime/createOpsApiRuntime.ts`
- `apps/api/src/runtime/createOpsApiRuntime.test.ts`
- `apps/api/src/runtime/main.ts`
- `apps/web/src/server/http/app.ts`
- `apps/web/src/server/http/monitorRoutes.ts`
- `apps/web/src/server/http/zaloRoutes.ts`
- `apps/web/src/server/storage/schema.ts`
- `apps/web/src/server/storage/store.ts`
- `apps/web/src/web/api.ts`
- `apps/web/src/web/App.tsx`
- `apps/web/src/web/App.test.tsx`
- `apps/web/src/web/components/LoginForm.tsx`
- `apps/web/src/web/styles.css`
- `deploy/ops/env/api.env.example`
- `deploy/ops/env/web.env.example`
- `deploy/ops/systemd/edutrack-ops-api.service`
- `deploy/ops/systemd/edutrack-ops-web.service`
- `deploy/ops/systemd/systemd-assets.test.ts`
- `deploy/ops/nginx/man.thienuy.edu.vn-api.conf`
- `deploy/ops/nginx/man.thienuy.edu.vn.conf.test.ts`
- `deploy/ops/prepare-release.sh`
- `deploy/ops/activate-release.sh`
- `deploy/ops/release-assets.test.ts`
- `scripts/ops/capture-public-contract.mjs`
- `scripts/ops/capture-public-contract.test.ts`
- `apps/web/e2e/production-parity.spec.ts`

---

### Task 1: Persist Account Administration State

**Files:**
- Create: `packages/db/migrations/0014_ops_account_administration.sql`
- Create: `packages/db/src/accountAdministrationMigration.test.ts`
- Modify: `packages/db/src/schema/auth.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/migrationManifest.ts`
- Modify: `packages/db/src/migrationManifest.test.ts`

**Interfaces:**
- Produces: `ops_users.login_blocked_until`, `administratively_locked_at`, `administratively_locked_by`, `lock_reason`, `revoked_by`; `ops_account_events`; enrollment purpose `invite`.
- Consumes: Existing `ops_users`, `ops_sessions`, `ops_mfa_enrollment_tokens`, and migration trust-root conventions.

- [ ] **Step 1: Write the failing migration contract test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../migrations/0014_ops_account_administration.sql', import.meta.url),
  'utf8'
);

describe('ops account administration migration', () => {
  it('separates login cooldown from owner lock and records account events', () => {
    expect(sql).toContain('login_blocked_until');
    expect(sql).toContain('administratively_locked_at');
    expect(sql).toContain('administratively_locked_by');
    expect(sql).toContain('CREATE TABLE ops_account_events');
    expect(sql).toMatch(/purpose IN \('bootstrap', 'recovery', 'invite'\)/u);
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing migration failure**

Run: `npx vitest run packages/db/src/accountAdministrationMigration.test.ts`

Expected: FAIL because `0014_ops_account_administration.sql` does not exist.

- [ ] **Step 3: Add the migration and matching Drizzle declarations**

The migration must rename `locked_until` to `login_blocked_until`, add nullable owner-lock/revoke actor columns with `ON DELETE RESTRICT`, replace the enrollment purpose check with `bootstrap|recovery|invite`, and create this value-free event table:

```sql
CREATE TABLE ops_account_events (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES ops_users(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES ops_users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'created','role_changed','administratively_locked','recovery_issued','activated','revoked'
  )),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
```

Add the same columns/table to `packages/db/src/schema/auth.ts` and export it through `schema/index.ts`.

- [ ] **Step 4: Pin the migration trust root and run database tests**

Run `sha256sum packages/db/migrations/0014_ops_account_administration.sql`, add the emitted digest as the `0014_ops_account_administration` entry in both trust-root expectations, then run:

`npx vitest run packages/db/src/accountAdministrationMigration.test.ts packages/db/src/migrationManifest.test.ts packages/db/src/migrate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0014_ops_account_administration.sql packages/db/src/accountAdministrationMigration.test.ts packages/db/src/schema/auth.ts packages/db/src/schema/index.ts packages/db/src/migrationManifest.ts packages/db/src/migrationManifest.test.ts
git commit -m "feat(auth): add account administration persistence"
```

### Task 2: Separate Login Cooldown From Administrative Lock

**Files:**
- Modify: `apps/api/src/modules/auth/authService.ts`
- Modify: `apps/api/src/modules/auth/authService.test.ts`
- Modify: `apps/api/src/modules/auth/postgresAuthRepository.ts`
- Modify: `apps/api/src/modules/auth/postgresAuthRepository.test.ts`

**Interfaces:**
- Produces: `PasswordCredential.loginBlockedUntil: string | null`; failed-login throttle updates only `login_blocked_until`.
- Consumes: Task 1 schema.

- [ ] **Step 1: Add failing service and repository tests**

```ts
it('denies a credential during login cooldown without changing account status', async () => {
  repository.findPasswordCredential.mockResolvedValue({
    ...activeCredential,
    loginBlockedUntil: '2026-08-31T12:30:00.000Z'
  });
  await expect(service.beginLogin(validLogin)).resolves.toEqual({ status: 'denied' });
});
```

Add a repository assertion that the fifth failure SQL contains `login_blocked_until` and does not contain `SET status = 'locked'`.

- [ ] **Step 2: Run the narrow tests and confirm failure**

Run: `npx vitest run apps/api/src/modules/auth/authService.test.ts apps/api/src/modules/auth/postgresAuthRepository.test.ts`

Expected: FAIL because the credential lacks `loginBlockedUntil` and SQL still sets `status='locked'`.

- [ ] **Step 3: Implement cooldown-only enforcement**

Select `login_blocked_until AS "loginBlockedUntil"`, reject while it is in the future, and update only that column after five failed events. Keep the account `active`; write reason `FAILED_LOGIN_THRESHOLD` without password/TOTP material.

- [ ] **Step 4: Run auth regression tests**

Run: `npx vitest run apps/api/src/modules/auth`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/authService.ts apps/api/src/modules/auth/authService.test.ts apps/api/src/modules/auth/postgresAuthRepository.ts apps/api/src/modules/auth/postgresAuthRepository.test.ts
git commit -m "fix(auth): separate login cooldown from account lock"
```

### Task 3: Add Generic Password-and-TOTP Step-Up Grants

**Files:**
- Create: `packages/db/migrations/0015_ops_secret_elevations.sql`
- Create: `apps/api/src/modules/auth/stepUpService.ts`
- Create: `apps/api/src/modules/auth/stepUpService.test.ts`
- Create: `apps/api/src/modules/auth/postgresStepUpRepository.ts`
- Create: `apps/api/src/modules/auth/postgresStepUpRepository.test.ts`
- Modify: `packages/db/src/schema/auth.ts`
- Modify: `packages/db/src/migrationManifest.ts`
- Modify: `packages/db/src/migrationManifest.test.ts`

**Interfaces:**
- Produces: `StepUpService.grant(input)`, `StepUpService.authorize(input)`, `StepUpService.consume(input)`, and `StepUpService.revoke(input)` for `accounts_write | variables_secret | variables_apply`.
- Produces: policy-driven grants bound to `userId`, `sessionId`, IP hash, user-agent hash, optional subject digest, and expiry. `accounts_write` and `variables_apply` are one-use; `variables_secret` is reusable for at most ten minutes and can be explicitly revoked.
- Produces: server-selected policy limits: `accounts_write` five minutes/one-use, `variables_secret` ten minutes/reusable, and `variables_apply` five minutes/one-use. Callers cannot request a longer lifetime or change consumption mode.
- Consumes: `verifyPassword`, `verifyTotp`, current password/TOTP repository data.

- [ ] **Step 1: Write failing grant/consume tests**

```ts
it('issues one accounts_write grant only after password and TOTP and consumes it once', async () => {
  const granted = await service.grant({
    capability: 'accounts_write', userId, sessionId, password, factorId, token: '123456',
    ipHash, userAgentHash
  });
  await expect(service.consume({ grantId: granted.id, capability: 'accounts_write', userId,
    sessionId, ipHash, userAgentHash })).resolves.toBe(true);
  await expect(service.consume({ grantId: granted.id, capability: 'accounts_write', userId,
    sessionId, ipHash, userAgentHash })).resolves.toBe(false);
});

it('authorizes variables_secret repeatedly until expiry or explicit revocation', async () => {
  const granted = await service.grant(validVariablesSecretProof);
  await expect(service.authorize(boundVariablesSecretRequest(granted.id))).resolves.toMatchObject({
    capability: 'variables_secret',
  });
  await expect(service.authorize(boundVariablesSecretRequest(granted.id))).resolves.toBeDefined();
  await service.revoke(boundVariablesSecretRequest(granted.id));
  await expect(service.authorize(boundVariablesSecretRequest(granted.id))).rejects.toMatchObject({
    code: 'STEP_UP_REVOKED',
  });
});
```

Also test wrong password, wrong TOTP, expired grant, wrong session/IP/UA, wrong capability, wrong subject digest, caller-supplied lifetime rejection, parent-session expiry capping, parent-session revoke, and replacement/revocation of an older unconsumed grant for the same session/capability.

- [ ] **Step 2: Run the new tests and confirm missing-module failure**

Run: `npx vitest run apps/api/src/modules/auth/stepUpService.test.ts apps/api/src/modules/auth/postgresStepUpRepository.test.ts`

Expected: FAIL because the modules and migration do not exist.

- [ ] **Step 3: Add the migration, repository, and service**

Use `ops_secret_elevations` with UUID primary key, typed capability, binding hashes, optional `subject_digest`, `expires_at`, `last_used_at`, `consumed_at`, and `revoked_at`. `consume` must be one atomic `UPDATE ... WHERE consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING id`. `authorize` must validate the same bindings and expiry, update only `last_used_at`, and reject one-use capabilities so callers cannot accidentally reuse them. Look up the applicable grant from the authenticated server-side session context; grant IDs are internal and never returned as browser bearer tokens.

- [ ] **Step 4: Pin the new migration and run tests**

Run `sha256sum packages/db/migrations/0015_ops_secret_elevations.sql`, add the emitted digest to both migration trust-root lists, then run:

`npx vitest run apps/api/src/modules/auth/stepUpService.test.ts apps/api/src/modules/auth/postgresStepUpRepository.test.ts packages/db/src/migrationManifest.test.ts packages/db/src/migrate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0015_ops_secret_elevations.sql packages/db/src/schema/auth.ts packages/db/src/migrationManifest.ts packages/db/src/migrationManifest.test.ts apps/api/src/modules/auth/stepUpService.ts apps/api/src/modules/auth/stepUpService.test.ts apps/api/src/modules/auth/postgresStepUpRepository.ts apps/api/src/modules/auth/postgresStepUpRepository.test.ts
git commit -m "feat(auth): add password and totp step-up grants"
```

### Task 4: Implement Account Lifecycle Service and Repository

**Files:**
- Create: `apps/api/src/modules/accounts/accountService.ts`
- Create: `apps/api/src/modules/accounts/accountService.test.ts`
- Create: `apps/api/src/modules/accounts/postgresAccountRepository.ts`
- Create: `apps/api/src/modules/accounts/postgresAccountRepository.test.ts`
- Modify: `packages/security/src/mfa/enrollmentToken.ts`
- Modify: `packages/security/src/mfa/enrollmentToken.test.ts`

**Interfaces:**
- Produces: `AccountService.list`, `create`, `changeRole`, `lock`, `recover`, and `revoke`.
- Produces: `EnrollmentLink { userId: string; enrollmentUrl: string; expiresAt: string }` returned once.
- Consumes: Task 3 `StepUpService.consume`, `issueEnrollmentToken`, `PostgresOpsAuditLedger`.

- [ ] **Step 1: Write failing lifecycle tests**

Cover the exact state transitions:

```ts
it.each([
  ['changeRole', 'self mutation'],
  ['lock', 'self mutation'],
  ['revoke', 'self mutation']
])('rejects %s against the acting owner', async (operation) => {
  await expect(runOperation(operation, { actorUserId: ownerId, targetUserId: ownerId }))
    .rejects.toThrow('ACCOUNT_SELF_PROTECTED');
});
```

Add tests for default maintainer, explicit viewer/owner, duplicate identifier, final-owner protection under transaction lock, 24-hour link, session/challenge revocation, locked-to-pending recovery, permanent revoke, and value-free audit metadata.

- [ ] **Step 2: Run the tests and confirm failure**

Run: `npx vitest run apps/api/src/modules/accounts`

Expected: FAIL because the account module does not exist.

- [ ] **Step 3: Implement service boundaries and atomic SQL transitions**

Use exact public types:

```ts
export type OpsAccountSummary = {
  id: string; username: string; email: string; displayName: string;
  role: OpsRole; status: 'pending_mfa' | 'active' | 'locked' | 'revoked';
  mfaEnrolled: boolean; createdAt: string; lastLoginAt: string | null;
};
```

Repository mutation methods must lock actor/target and active-owner count with `FOR UPDATE`, enforce invariants, revoke sessions/challenges/grants/tokens in the same transaction, and append `ops_account_events`. Service methods append the hash-chain audit after a successful repository transaction using IDs/statuses only.

- [ ] **Step 4: Run lifecycle tests**

Run: `npx vitest run apps/api/src/modules/accounts packages/security/src/mfa/enrollmentToken.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/accounts packages/security/src/mfa/enrollmentToken.ts packages/security/src/mfa/enrollmentToken.test.ts
git commit -m "feat(accounts): add owner controlled account lifecycle"
```

### Task 5: Make Enrollment Set a Fresh Password and TOTP

**Files:**
- Modify: `apps/api/src/modules/auth/totpEnrollment.ts`
- Modify: `apps/api/src/modules/auth/totpEnrollment.test.ts`
- Modify: `apps/api/src/modules/auth/postgresTotpEnrollmentRepository.ts`
- Modify: `apps/api/src/modules/auth/postgresTotpEnrollmentRepository.test.ts`
- Modify: `apps/api/src/modules/auth/authRoutes.ts`
- Modify: `apps/api/src/modules/auth/authRoutes.test.ts`
- Modify: `apps/api/src/runtime/runtimeConfig.ts`
- Modify: `apps/api/src/runtime/runtimeConfig.test.ts`
- Modify: `deploy/ops/env/api.env.example`
- Modify: `deploy/ops/systemd/edutrack-ops-api.service`

**Interfaces:**
- Produces: `TotpEnrollmentService.verify({ userId, token, factorId, otp, password })`.
- Consumes: `hashPassword`, `validatePasswordPolicy`, and a dedicated password-fingerprint pepper credential.

- [ ] **Step 1: Add failing enrollment tests**

```ts
await expect(service.verify({ userId, token, factorId, otp: '123456', password: strongPassword }))
  .resolves.toBe(true);
expect(repository.activate).toHaveBeenCalledWith(expect.objectContaining({
  passwordHash: expect.stringContaining('$argon2id$'),
  passwordFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
}));
```

Test password policy rejection, token reuse, recovery superseding old password/factors, and activation rollback when any write fails.

- [ ] **Step 2: Run tests and confirm the old signature fails**

Run: `npx vitest run apps/api/src/modules/auth/totpEnrollment.test.ts apps/api/src/modules/auth/postgresTotpEnrollmentRepository.test.ts apps/api/src/modules/auth/authRoutes.test.ts`

Expected: FAIL because `password` and credential activation are unsupported.

- [ ] **Step 3: Implement transactional credential activation**

Add `OPS_PASSWORD_FINGERPRINT_PEPPER_REFERENCE=ops-password-fingerprint-pepper`, load it as a systemd credential, and inject `hashPassword`/`passwordFingerprint` into the enrollment service. The activation CTE must consume the token, supersede active password credentials and MFA factors, insert the new password credential, activate the selected TOTP factor, and change `pending_mfa -> active` atomically.

- [ ] **Step 4: Run auth/runtime/systemd tests**

Run: `npx vitest run apps/api/src/modules/auth apps/api/src/runtime/runtimeConfig.test.ts deploy/ops/systemd/systemd-assets.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth apps/api/src/runtime/runtimeConfig.ts apps/api/src/runtime/runtimeConfig.test.ts deploy/ops/env/api.env.example deploy/ops/systemd/edutrack-ops-api.service
git commit -m "feat(auth): enroll fresh password and totp"
```

### Task 6: Expose Owner Account APIs and Rich Session Identity

**Files:**
- Create: `apps/api/src/modules/accounts/accountRoutes.ts`
- Create: `apps/api/src/modules/accounts/accountRoutes.test.ts`
- Modify: `packages/security/src/sessions.ts`
- Modify: `packages/security/src/sessions.test.ts`
- Modify: `packages/db/src/repositories/opsSessions.ts`
- Modify: `packages/db/src/repositories/opsSessions.test.ts`
- Modify: `apps/api/src/modules/auth/sessionAuthorization.ts`
- Modify: `apps/api/src/modules/auth/sessionAuthorization.test.ts`
- Modify: `apps/api/src/modules/auth/authRoutes.ts`
- Modify: `apps/api/src/modules/auth/authRoutes.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/runtime/createOpsApiRuntime.ts`
- Modify: `apps/api/src/runtime/createOpsApiRuntime.test.ts`

**Interfaces:**
- Produces: `/api/v1/users` routes from the spec and `/api/v1/auth/accounts/authorization`.
- Produces: session response `{ userId, username, displayName, role, csrfToken? }` without exposing the session token.
- Consumes: Tasks 3–5 services.

- [ ] **Step 1: Write failing route authorization tests**

Test `401` without canonical session, `403` for viewer/maintainer, `403` without `accounts:write`, `401` for missing/consumed step-up grant, `200 { authorizedUntil }` from the password+TOTP authorization route with no grant ID/token, `201` create with one-time link, `204` lock/revoke, `200` recovery link, and exact username confirmation.

- [ ] **Step 2: Run route/session tests and confirm failure**

Run: `npx vitest run apps/api/src/modules/accounts/accountRoutes.test.ts apps/api/src/modules/auth/authRoutes.test.ts apps/api/src/modules/auth/sessionAuthorization.test.ts packages/security/src/sessions.test.ts`

Expected: FAIL because routes and enriched principal do not exist.

- [ ] **Step 3: Implement routes and permission checks**

Add `accounts:write` only to `ops_owner`. All bodies are `.strict()` Zod schemas; role accepts only canonical role strings; revoke body is `{ confirmationUsername: string }`. Each mutation atomically consumes the newest valid `accounts_write` grant resolved from the canonical server-side session and request bindings. Add `Cache-Control: no-store` to authorization/session/account/enrollment responses.

- [ ] **Step 4: Wire runtime and run API regression tests**

Run: `npx vitest run apps/api/src packages/security/src/sessions.test.ts packages/db/src/repositories/opsSessions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/accounts apps/api/src/modules/auth apps/api/src/index.ts apps/api/src/runtime/createOpsApiRuntime.ts apps/api/src/runtime/createOpsApiRuntime.test.ts packages/security/src/sessions.ts packages/security/src/sessions.test.ts packages/db/src/repositories/opsSessions.ts packages/db/src/repositories/opsSessions.test.ts
git commit -m "feat(api): expose canonical account administration"
```

### Task 7: Move the React Shell and Login to Canonical Auth

**Files:**
- Create: `apps/web/src/web/routing.ts`
- Create: `apps/web/src/web/components/OpsShell.tsx`
- Create: `apps/web/src/web/pages/OverviewPage.tsx`
- Modify: `apps/web/src/web/api.ts`
- Modify: `apps/web/src/web/App.tsx`
- Modify: `apps/web/src/web/App.test.tsx`
- Modify: `apps/web/src/web/components/LoginForm.tsx`
- Modify: `apps/web/src/web/styles.css`

**Interfaces:**
- Produces: routes `/`, `/users`, `/bootstrap/mfa`; navigation via History API without a new router dependency.
- Consumes: `/api/v1/auth/login`, `/login/totp`, `/session`, `/logout`, and enrollment routes.

- [ ] **Step 1: Replace legacy login mocks with failing canonical two-step tests**

Test password submit returns MFA challenge, selected factor + six-digit code completes login, `GET /api/v1/auth/session` restores identity, logout sends `X-Ops-CSRF`, and direct `/users` navigation is preserved across refresh.

- [ ] **Step 2: Run the App tests and confirm legacy-route failures**

Run: `npx vitest run --config apps/web/vite.config.ts apps/web/src/web/App.test.tsx`

Expected: FAIL because the UI still calls `/api/session` and has no router/shell.

- [ ] **Step 3: Implement canonical client and shell**

Use these request paths exactly:

```ts
export const beginLogin = (identifier: string, password: string) =>
  request<MfaRequired>('/api/v1/auth/login', post({ identifier, password }));
export const completeLogin = (input: CompleteTotpInput) =>
  request<CanonicalSession>('/api/v1/auth/login/totp', post(input));
export const getSession = () => request<CanonicalSession>('/api/v1/auth/session');
```

Keep CSRF only in React memory. `OpsShell` renders `Tổng quan | Variables | Người dùng`; the Users link is owner-only, but route authorization still lives on the API.

- [ ] **Step 4: Run web tests**

Run: `npm run test --workspace @edutrack-ops/web -- --run`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/web
git commit -m "feat(web): use canonical auth and routed ops shell"
```

### Task 8: Build the Approved Users Workspace

**Files:**
- Create: `apps/web/src/web/pages/UsersPage.tsx`
- Create: `apps/web/src/web/pages/UsersPage.test.tsx`
- Create: `apps/web/src/web/components/RevokeUserDialog.tsx`
- Create: `apps/web/src/web/components/RevokeUserDialog.test.tsx`
- Modify: `apps/web/src/web/api.ts`
- Modify: `apps/web/src/web/styles.css`

**Interfaces:**
- Produces: approved account list/create/link/lock/recover/revoke UI.
- Consumes: Task 6 account/session API and Task 7 shell.

- [ ] **Step 1: Write failing interaction tests**

Test owner-only render, default Maintainer, one-time full enrollment link, 24-hour copy, self/final-owner disabled reason, lock wording, recovery re-enrollment wording, revoked terminal row, and exact-username permanent revoke dialog.

- [ ] **Step 2: Run page tests and confirm missing page failure**

Run: `npx vitest run --config apps/web/vite.config.ts apps/web/src/web/pages/UsersPage.test.tsx apps/web/src/web/components/RevokeUserDialog.test.tsx`

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement the Superdesign-approved state**

Do not persist the returned enrollment URL. Hold it in component state, clear it on navigation/unmount/copy-dismiss, apply `autocomplete="off"` to the displayed token field, and render API reason codes rather than interpolating server error text.

- [ ] **Step 4: Run web tests and typecheck**

Run: `npm run test --workspace @edutrack-ops/web -- --run && npm run typecheck --workspace @edutrack-ops/web`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/web/pages/UsersPage.tsx apps/web/src/web/pages/UsersPage.test.tsx apps/web/src/web/components/RevokeUserDialog.tsx apps/web/src/web/components/RevokeUserDialog.test.tsx apps/web/src/web/api.ts apps/web/src/web/styles.css
git commit -m "feat(web): add owner user administration"
```

### Task 9: Add a Canonical Monitoring Compatibility Adapter

**Files:**
- Create: `packages/contracts/src/legacyMonitoringProtocol.ts`
- Create: `packages/contracts/src/legacyMonitoringProtocol.test.ts`
- Create: `apps/api/src/modules/monitoring/legacyMonitoringClient.ts`
- Create: `apps/api/src/modules/monitoring/legacyMonitoringClient.test.ts`
- Create: `apps/api/src/modules/monitoring/monitoringRoutes.ts`
- Create: `apps/api/src/modules/monitoring/monitoringRoutes.test.ts`
- Create: `apps/web/src/server/http/internalCanonicalRoutes.ts`
- Create: `apps/web/src/server/http/internalCanonicalRoutes.test.ts`
- Modify: `apps/web/src/server/http/app.ts`
- Modify: `apps/web/src/server/http/monitorRoutes.ts`
- Modify: `apps/web/src/server/http/zaloRoutes.ts`
- Modify: `apps/web/src/server/storage/schema.ts`
- Modify: `apps/web/src/server/storage/store.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/runtime/runtimeConfig.ts`
- Modify: `apps/api/src/runtime/createOpsApiRuntime.ts`
- Modify: `apps/web/src/web/api.ts`

**Interfaces:**
- Produces: canonical `/api/v1/monitoring/overview`, `/infrastructure/history`, `/incidents/:id/ack`, and `/zalo/*`.
- Consumes: canonical principal and an HMAC-authenticated loopback-only `/internal/v1/monitoring/*` adapter on port 3101.

- [ ] **Step 1: Write failing signature, replay, proxy, and principal tests**

The signed canonical form is:

```text
v1\nMETHOD\nPATH_WITH_QUERY\nTIMESTAMP\nNONCE\nBODY_SHA256\nUSER_ID\nROLE
```

Test a 30-second timestamp window, timing-safe signature, bounded nonce replay cache, exact path allowlist, body-size limit, canonical user ID propagation for incident/Zalo audit, and refusal of legacy cookie-only requests.

- [ ] **Step 2: Run the new monitoring tests and confirm failure**

Run: `npx vitest run packages/contracts/src/legacyMonitoringProtocol.test.ts apps/api/src/modules/monitoring apps/web/src/server/http/internalCanonicalRoutes.test.ts`

Expected: FAIL because the protocol and adapter do not exist.

- [ ] **Step 3: Implement the loopback adapter and SQLite principal migration**

Keep monitor samples/incidents in SQLite for this transition. Replace Zalo account foreign keys with canonical `principal_id TEXT` in the existing versioned SQLite migration, map legacy rows by the two explicitly enrolled usernames during the cutover command, and remove password/session lookup from all internal routes. Do not expose `/internal/v1` through Nginx.

- [ ] **Step 4: Switch browser overview/Zalo calls to canonical paths and run regressions**

Run: `npx vitest run packages/contracts/src/legacyMonitoringProtocol.test.ts apps/api/src/modules/monitoring apps/web/src/server && npm run test --workspace @edutrack-ops/web -- --run`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/legacyMonitoringProtocol.ts packages/contracts/src/legacyMonitoringProtocol.test.ts apps/api/src/modules/monitoring apps/api/src/index.ts apps/api/src/runtime apps/web/src/server apps/web/src/web/api.ts
git commit -m "feat(monitoring): authorize legacy data through canonical api"
```

### Task 10: Cut Nginx and Deployment Assets to Canonical Browser Auth

**Files:**
- Modify: `deploy/ops/env/api.env.example`
- Modify: `deploy/ops/env/web.env.example`
- Modify: `deploy/ops/systemd/edutrack-ops-api.service`
- Modify: `deploy/ops/systemd/edutrack-ops-web.service`
- Modify: `deploy/ops/systemd/systemd-assets.test.ts`
- Modify: `deploy/ops/nginx/man.thienuy.edu.vn-api.conf`
- Modify: `deploy/ops/nginx/man.thienuy.edu.vn.conf.test.ts`
- Modify: `deploy/ops/prepare-release.sh`
- Modify: `deploy/ops/activate-release.sh`
- Modify: `deploy/ops/release-assets.test.ts`
- Modify: `scripts/ops/capture-public-contract.mjs`
- Modify: `scripts/ops/capture-public-contract.test.ts`
- Modify: `apps/web/e2e/production-parity.spec.ts`
- Create: `docs/runbooks/ops-canonical-auth-cutover.md`

**Interfaces:**
- Produces: public browser traffic only through `/api/v1`; the unauthenticated Zalo webhook remains its single exact legacy-server route.
- Consumes: Tasks 1–9.

- [ ] **Step 1: Change deployment tests first**

Require `/api/v1/** -> 3100`, `/ -> 3101`, exact `/api/zalo-bot/webhook -> 3101`, `/api/session -> 410`, and no generic public `location /api/`. Require separate HMAC credential references in both services and assert the secret placeholders are empty.

- [ ] **Step 2: Run deployment/public-contract tests and confirm failure**

Run: `npx vitest run deploy/ops/nginx/man.thienuy.edu.vn.conf.test.ts deploy/ops/systemd/systemd-assets.test.ts deploy/ops/release-assets.test.ts scripts/ops/capture-public-contract.test.ts`

Expected: FAIL because generic legacy `/api` ownership remains.

- [ ] **Step 3: Implement assets and write the exact cutover runbook**

The runbook must include: migrate; bootstrap/enroll `tuan.dev`; create/enroll `ops-admin`; canonical login/session/user/overview/Zalo smoke; backup SQLite; activate Nginx; verify old cookie gets `401/410`; rollback release/Nginx without copying sessions; and retain SQLite read-only until a separately approved deletion.

- [ ] **Step 4: Run full repository verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:e2e
```

Expected: all commands exit 0. If Nginx is unavailable, the Nginx integration test must report its existing explicit prerequisite failure; install/enable the prerequisite before claiming this task complete.

- [ ] **Step 5: Commit**

```bash
git add deploy/ops scripts/ops apps/web/e2e/production-parity.spec.ts docs/runbooks/ops-canonical-auth-cutover.md
git commit -m "feat(auth): cut ops console to canonical sessions"
```

---

## Plan Completion Gate

- Canonical owner and maintainer flows pass locally and in an isolated PostgreSQL integration environment.
- Legacy cookies cannot authorize any browser operation.
- Owner self/final-owner invariants survive concurrent mutation tests.
- The approved Users page works from create through enrollment, lock/recovery, and revoke.
- Monitoring behavior is preserved through the canonical adapter without trusting SQLite sessions.
- Do not begin the read-only Variables plan until this plan's full verification and cutover rehearsal pass.
