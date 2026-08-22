# EduTrack Ops Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create and deploy the independent `edutrack-ops` foundation with separate accounts, mandatory MFA, RBAC/elevation, tamper-evident off-host audit, health APIs, and the base `man.thienuy.edu.vn` shell.

**Architecture:** Use an npm-workspace repository with separate React web, Express API, background processor/notifier, and SQL-worker entrypoints plus shared contract/database/security packages. Store Ops identity/session/audit state in a separate PostgreSQL database and use private S3-compatible object storage for encrypted artifacts. Deploy all public access through a dedicated Nginx vhost; the SQL worker remains private and production SQL stays disabled.

**Tech Stack:** Node.js 22.22+, TypeScript 5.8, npm workspaces, React 19, Vite 6, Express 5, PostgreSQL 16, Drizzle ORM, Zod, Argon2id, SimpleWebAuthn, OTPAuth, Vitest, Testing Library, Playwright, PM2, Nginx, MinIO/S3 API.

**Spec:** `docs/superpowers/specs/2026-08-22-edutrack-ops-plane-design.md`

## Global Constraints

- Ops credentials, sessions, cookies, database, and secrets are never shared with EduTrack.
- Cookie name is `edutrack_ops_session`; it is host-only, `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`.
- Session idle timeout is 30 minutes and absolute lifetime is 12 hours.
- SQL elevation idle timeout is 15 minutes and absolute lifetime is 30 minutes.
- Passkey/WebAuthn is primary MFA; TOTP and single-use recovery codes are fallback factors.
- `ops_viewer`, `ops_maintainer`, and `ops_owner` are the only roles.
- Account creation/recovery is never public. First-owner bootstrap is an offline, single-use CLI flow.
- All authenticated mutations require a synchronizer CSRF token.
- High-risk audit receipts are anchored off-host before the privileged action proceeds.
- Committed defaults keep SQL read, mutation, DDL, and break-glass flags disabled.

---

### Task 1: Scaffold the independent workspace and quality gates

**Files:**
- Create: `edutrack-ops/package.json`
- Create: `edutrack-ops/package-lock.json`
- Create: `edutrack-ops/tsconfig.base.json`
- Create: `edutrack-ops/eslint.config.js`
- Create: `edutrack-ops/.prettierrc`
- Create: `edutrack-ops/.gitignore`
- Create: `edutrack-ops/.env.example`
- Create: `edutrack-ops/apps/{web,api,processor,notifier,sql-worker}/package.json`
- Create: `edutrack-ops/packages/{contracts,db,security,test-utils}/package.json`
- Create: `edutrack-ops/.github/workflows/ci.yml`

**Interfaces:**
- Produces: workspace commands `typecheck`, `lint`, `format:check`, `test`, `build`, and `test:e2e`.

- [ ] **Step 1: Create the workspace manifest**

Use this script contract:

```json
{
  "private": true,
  "engines": { "node": ">=22.22.0" },
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "typecheck": "tsc -b --pretty false",
    "lint": "eslint . --ext .ts,.tsx",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "build": "npm run build --workspaces --if-present",
    "test:e2e": "playwright test"
  }
}
```

Pin dependencies through `package-lock.json`; do not use floating `latest` ranges in committed manifests.

- [ ] **Step 2: Define environment validation inputs**

`.env.example` contains names and safe examples only:

```text
OPS_PUBLIC_URL=https://man.thienuy.edu.vn
OPS_DATABASE_URL=postgres://ops:change-me@127.0.0.1:5432/edutrack_ops
OPS_SESSION_SECRET=replace-with-32-random-bytes
OPS_FIELD_ENCRYPTION_KEY=replace-with-32-random-bytes
OPS_AUDIT_SIGNING_KEY_FILE=/run/credentials/ops-audit-ed25519
OPS_OBJECT_STORE_ENDPOINT=https://backup.internal
OPS_OBJECT_STORE_BUCKET=edutrack-ops-private
OPS_SQL_READ_ENABLED=false
OPS_SQL_MUTATION_ENABLED=false
OPS_SQL_DDL_ENABLED=false
OPS_SQL_BREAK_GLASS_ENABLED=false
```

- [ ] **Step 3: Add CI**

CI uses Node 22, `npm ci`, dependency audit, typecheck, lint, format check, tests, builds, migration-from-empty test, and Playwright smoke. No production secret is available to pull-request jobs.

- [ ] **Step 4: Run baseline checks and commit**

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
git add package.json package-lock.json tsconfig.base.json eslint.config.js .prettierrc .gitignore .env.example apps packages .github
git commit -m "chore: scaffold edutrack ops workspace"
```

---

### Task 2: Create Ops database schema and migration runner

**Files:**
- Create: `edutrack-ops/packages/db/src/client.ts`
- Create: `edutrack-ops/packages/db/src/schema/auth.ts`
- Create: `edutrack-ops/packages/db/src/schema/audit.ts`
- Create: `edutrack-ops/packages/db/src/schema/health.ts`
- Create: `edutrack-ops/packages/db/src/schema/index.ts`
- Create: `edutrack-ops/packages/db/migrations/0001_ops_foundation.sql`
- Create: `edutrack-ops/packages/db/src/migrate.ts`
- Create: `edutrack-ops/packages/db/src/migrate.test.ts`
- Create: `edutrack-ops/packages/db/src/repositories/opsUsers.ts`
- Create: `edutrack-ops/packages/db/src/repositories/opsSessions.ts`

**Interfaces:**
- Produces: `getOpsPool()`, `getOpsDb()`, `migrateOpsDatabase()`, `OpsUserRepository`, and `OpsSessionRepository`.

- [ ] **Step 1: Write migration-from-empty tests**

Use disposable PostgreSQL and assert these tables exist after migration:

```ts
expect(tables).toEqual(expect.arrayContaining([
  'ops_users',
  'ops_password_credentials',
  'ops_mfa_factors',
  'ops_recovery_codes',
  'ops_sessions',
  'ops_login_events',
  'ops_elevation_events',
  'ops_audit_entries',
  'ops_audit_checkpoints',
  'service_heartbeats',
]));
```

Run migration twice and require the second run to make no changes.

- [ ] **Step 2: Run RED**

Run: `npx vitest run packages/db/src/migrate.test.ts`

- [ ] **Step 3: Implement schema invariants**

Require:

- unique case-insensitive username/email;
- role check for exactly three roles;
- status check `pending_mfa|active|locked|revoked`;
- password and session hashes only, never plaintext;
- MFA type `webauthn|totp` with encrypted secret/credential metadata;
- recovery-code hashes with `used_at`;
- session `idle_expires_at`, `absolute_expires_at`, `revoked_at`, IP hash, user agent;
- append-only audit sequence/hash columns;
- foreign keys use `RESTRICT` where deleting history would lose attribution.

- [ ] **Step 4: Implement repositories with parameterized queries**

Repository methods return allowlisted fields. Session lookup hashes the presented token with SHA-256 plus a server pepper and updates activity at most once every five minutes.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx vitest run packages/db/src/migrate.test.ts packages/db/src/repositories
git add packages/db
git commit -m "feat(db): add ops identity and audit schema"
```

---

### Task 3: Implement password policy and offline owner bootstrap

**Files:**
- Create: `edutrack-ops/packages/security/src/passwords.ts`
- Create: `edutrack-ops/packages/security/src/passwords.test.ts`
- Create: `edutrack-ops/apps/api/src/cli/bootstrapOwner.ts`
- Create: `edutrack-ops/apps/api/src/cli/bootstrapOwner.test.ts`
- Create: `edutrack-ops/docs/runbooks/ops-account-recovery.md`

**Interfaces:**
- Produces: `hashPassword`, `verifyPassword`, `needsPasswordRehash`, and `bootstrapOwner(input)`.

- [ ] **Step 1: Write failing password tests**

```ts
const encoded = await hashPassword('a-long-unique-passphrase');
expect(encoded).toMatch(/^\$argon2id\$/);
await expect(verifyPassword(encoded, 'wrong')).resolves.toBe(false);
await expect(verifyPassword(encoded, 'a-long-unique-passphrase')).resolves.toBe(true);
```

Reject passwords shorter than 14 characters, listed breached/demo passwords, username/email inclusion, and reuse of the last five password fingerprints.

- [ ] **Step 2: Implement Argon2id calibration and encoding**

Calibrate to approximately 250–500 ms on the Ops host within a memory ceiling, enforce minimum memory/time/parallelism floors, and store the complete standard encoded hash. Tests use deterministic lower-cost test parameters through dependency injection.

- [ ] **Step 3: Write and implement bootstrap tests**

The CLI must require TTY confirmation, refuse when an active owner already exists unless `--additional-owner` is explicitly supplied, create a `pending_mfa` owner, and output one single-use enrollment URL. It must never output the password or database URL.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run packages/security/src/passwords.test.ts apps/api/src/cli/bootstrapOwner.test.ts
git add packages/security apps/api/src/cli docs/runbooks/ops-account-recovery.md
git commit -m "feat(auth): bootstrap ops owners with argon2id credentials"
```

---

### Task 4: Implement WebAuthn, TOTP, and recovery factors

**Files:**
- Create: `edutrack-ops/packages/security/src/mfa/types.ts`
- Create: `edutrack-ops/packages/security/src/mfa/webauthn.ts`
- Create: `edutrack-ops/packages/security/src/mfa/totp.ts`
- Create: `edutrack-ops/packages/security/src/mfa/recoveryCodes.ts`
- Test: `edutrack-ops/packages/security/src/mfa/*.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/auth/mfaRoutes.ts`
- Test: `edutrack-ops/apps/api/src/modules/auth/mfaRoutes.test.ts`

**Interfaces:**
- Produces: `beginWebAuthnRegistration`, `verifyWebAuthnRegistration`, `verifyWebAuthnAuthentication`, `verifyTotp`, `issueRecoveryCodes`, and `consumeRecoveryCode`.

- [ ] **Step 1: Define factor contract**

```ts
export type MfaProof = {
  userId: string;
  factorId: string;
  factorType: 'webauthn' | 'totp' | 'recovery_code';
  verifiedAt: string;
};
```

- [ ] **Step 2: Write RED tests**

Cover RP ID `man.thienuy.edu.vn`, expected origin, challenge single-use/expiry, signature counter rollback, TOTP ±1 step only, encrypted TOTP secret, ten one-time recovery codes, atomic recovery-code consumption, and MFA requirement before `pending_mfa -> active`.

- [ ] **Step 3: Implement factor services and routes**

Use `@simplewebauthn/server`, `@simplewebauthn/browser`, and `otpauth`; encrypt factor secrets with versioned AES-256-GCM envelope keys. Log metadata only.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx vitest run packages/security/src/mfa apps/api/src/modules/auth/mfaRoutes.test.ts
git add packages/security/src/mfa apps/api/src/modules/auth
git commit -m "feat(auth): require passkey or totp mfa"
```

---

### Task 5: Implement sessions, CSRF, RBAC, rate limits, and SQL elevation

**Files:**
- Create: `edutrack-ops/packages/contracts/src/auth.ts`
- Create: `edutrack-ops/apps/api/src/modules/auth/sessionService.ts`
- Create: `edutrack-ops/apps/api/src/modules/auth/sessionService.test.ts`
- Create: `edutrack-ops/apps/api/src/middleware/authenticate.ts`
- Create: `edutrack-ops/apps/api/src/middleware/authorize.ts`
- Create: `edutrack-ops/apps/api/src/middleware/csrf.ts`
- Create: `edutrack-ops/apps/api/src/middleware/rateLimit.ts`
- Test: `edutrack-ops/apps/api/src/middleware/*.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/auth/authRoutes.ts`

**Interfaces:**
- Produces: `OpsPrincipal`, `createSession`, `loadSession`, `requireRole`, `requireCsrf`, and `requireSqlElevation`.

- [ ] **Step 1: Define principal and elevation types**

```ts
export type OpsRole = 'ops_viewer' | 'ops_maintainer' | 'ops_owner';
export type OpsPrincipal = {
  userId: string;
  sessionId: string;
  role: OpsRole;
  mfaVerifiedAt: string;
  sqlElevationExpiresAt: string | null;
};
```

- [ ] **Step 2: Write RED security-matrix tests**

Cover missing/expired/revoked sessions, exact cookie attributes, 30-minute idle, 12-hour absolute, per-session CSRF token, Origin/Fetch-Site rejection, viewer mutation denial, maintainer account-management denial, 15-minute elevation idle, 30-minute elevation absolute, and five-minute MFA freshness for high risk.

- [ ] **Step 3: Implement sessions and middleware**

Generate 32-byte random tokens, store only hashes, rotate on login/elevation, revoke all sessions after credential/factor recovery, and return generic login failures. Use transaction/row locks for rate-limit updates.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx vitest run apps/api/src/modules/auth apps/api/src/middleware
git add packages/contracts/src/auth.ts apps/api/src/modules/auth apps/api/src/middleware
git commit -m "feat(auth): enforce ops sessions rbac csrf and elevation"
```

---

### Task 6: Build tamper-evident audit and off-host anchoring

**Files:**
- Create: `edutrack-ops/packages/security/src/audit/canonicalJson.ts`
- Create: `edutrack-ops/packages/security/src/audit/hashChain.ts`
- Create: `edutrack-ops/packages/security/src/audit/checkpointSigner.ts`
- Test: `edutrack-ops/packages/security/src/audit/*.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/audit/auditService.ts`
- Create: `edutrack-ops/apps/api/src/modules/audit/auditService.test.ts`
- Create: `edutrack-ops/apps/processor/src/jobs/anchorAudit.ts`
- Create: `edutrack-ops/apps/processor/src/jobs/verifyAudit.ts`
- Create: `edutrack-ops/apps/processor/src/jobs/verifyAudit.test.ts`

**Interfaces:**
- Produces: `appendAuditEntry`, `anchorCheckpoint`, `anchorHighRiskReceipt`, and `verifyAuditChain`.

- [ ] **Step 1: Write canonicalization/hash tests**

Require stable UTF-8 JSON key ordering, explicit null handling, increasing sequence, `previousHash`, SHA-256 `entryHash`, and failure on edit/delete/reorder/duplicate.

- [ ] **Step 2: Write signing/receiver tests**

Sign checkpoint digests with Ed25519; verify using public key. Mock off-host receiver failure and assert `anchorHighRiskReceipt` fails closed while normal five-minute checkpoint job retries idempotently.

- [ ] **Step 3: Implement transaction-safe append**

Lock the audit head row, insert the next sequence/hash, and update the head in one transaction. The application role has INSERT/SELECT only; migrations create database rules/grants that reject UPDATE/DELETE.

- [ ] **Step 4: Implement anchoring and verification**

Write signed canonical checkpoint JSON to the private append-only bucket/receiver with key `audit/YYYY/MM/DD/<sequence>-<entryHash>.json`. Store receiver ETag/hash in `ops_audit_checkpoints`.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx vitest run packages/security/src/audit apps/api/src/modules/audit apps/processor/src/jobs/verifyAudit.test.ts
git add packages/security/src/audit apps/api/src/modules/audit apps/processor/src/jobs
git commit -m "feat(audit): anchor tamper evident ops history off host"
```

---

### Task 7: Create API bootstrap, security headers, and health aggregation

**Files:**
- Create: `edutrack-ops/apps/api/src/app.ts`
- Create: `edutrack-ops/apps/api/src/app.test.ts`
- Create: `edutrack-ops/apps/api/src/index.ts`
- Create: `edutrack-ops/apps/api/src/config.ts`
- Create: `edutrack-ops/apps/api/src/config.test.ts`
- Create: `edutrack-ops/apps/api/src/middleware/requestContext.ts`
- Create: `edutrack-ops/apps/api/src/modules/operations/healthRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/operations/healthRoutes.test.ts`

**Interfaces:**
- Produces: `createOpsApp`, `startOpsApi`, validated config, request IDs, liveness/readiness, and authenticated health summary.

- [ ] **Step 1: Write RED app-boundary tests**

Require disabled `x-powered-by`, strict body limits, validated/generated `REQ_` ID, JSON 404, safe final error, CSP/security headers via Nginx contract, public `/liveness`, dependency-aware `/readiness`, and authenticated `/api/v1/operations/health`.

- [ ] **Step 2: Implement config validation**

Use Zod. In production require HTTPS public URL, 32-byte session/encryption keys, non-production Ops DB name, readable signing-key credential, private object bucket, and all SQL flags explicitly set.

- [ ] **Step 3: Implement app/startup/shutdown**

Validate config, check Ops DB/object store/audit receiver, start only on `127.0.0.1`, handle SIGTERM/SIGINT, drain requests, close pools, and emit sanitized JSON startup/shutdown logs.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run apps/api/src/app.test.ts apps/api/src/config.test.ts apps/api/src/modules/operations
git add apps/api/src
git commit -m "feat(api): bootstrap secure ops api and health"
```

---

### Task 8: Build the operations web shell and account screens

**Files:**
- Create: `edutrack-ops/apps/web/index.html`
- Create: `edutrack-ops/apps/web/vite.config.ts`
- Create: `edutrack-ops/apps/web/src/main.tsx`
- Create: `edutrack-ops/apps/web/src/App.tsx`
- Create: `edutrack-ops/apps/web/src/styles.css`
- Create: `edutrack-ops/apps/web/src/components/OpsShell.tsx`
- Create: `edutrack-ops/apps/web/src/components/ProductionBadge.tsx`
- Create: `edutrack-ops/apps/web/src/auth/OpsAuthProvider.tsx`
- Create: `edutrack-ops/apps/web/src/pages/LoginPage.tsx`
- Create: `edutrack-ops/apps/web/src/pages/MfaPage.tsx`
- Create: `edutrack-ops/apps/web/src/pages/OverviewPage.tsx`
- Create: `edutrack-ops/apps/web/src/pages/AccountsPage.tsx`
- Create: `edutrack-ops/apps/web/src/pages/SecurityAuditPage.tsx`
- Test: matching `*.test.tsx` files.

**Interfaces:**
- Produces: authenticated shell/routes and reusable `OpsShell`/`ProductionBadge` for later plans.

- [ ] **Step 1: Write route and authorization tests**

Assert unauthenticated routes redirect to `/login`, `pending_mfa` redirects to `/mfa`, viewer cannot open Accounts, owner can create/revoke an account, session expiry returns to login, and `PRODUCTION` badge is visible on every authenticated screen.

- [ ] **Step 2: Implement visual foundation**

Use existing EduTrack font/token direction but a denser operations layout: fixed left navigation, top health strip, 12-column content grid, semantic severity colors plus icons/text, visible keyboard focus, minimum 44px destructive controls, and no destructive action based on color alone.

- [ ] **Step 3: Implement auth/account flows**

Use same-origin API, CSRF header, WebAuthn browser API, TOTP fallback, safe generic errors, session refresh, and account create/revoke confirmation. Do not store session/MFA secrets in localStorage.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run apps/web/src
npm run build --workspace apps/web
git add apps/web
git commit -m "feat(web): add ops authentication and shell"
```

---

### Task 9: Deploy `man` independently with SQL disabled

**Files:**
- Create: `edutrack-ops/deploy/vps/ecosystem.config.cjs`
- Create: `edutrack-ops/deploy/vps/nginx.conf`
- Create: `edutrack-ops/deploy/vps/activate-release.sh`
- Create: `edutrack-ops/deploy/vps/validate-environment.mjs`
- Create: `edutrack-ops/deploy/vps/validate-environment.test.ts`
- Create: `edutrack-ops/deploy/vps/logrotate.conf`
- Create: `edutrack-ops/deploy/vps/backup-ops-postgres.sh`
- Create: `edutrack-ops/deploy/vps/restore-ops-postgres-drill.sh`
- Create: `edutrack-ops/deploy/vps/ops-backup.test.ts`
- Create: `edutrack-ops/docs/runbooks/ops-deployment.md`

**Interfaces:**
- Produces: immutable release activation, rollback, Nginx TLS vhost, PM2 processes, and environment validation.

- [ ] **Step 1: Write deployment safety tests**

Require host `man.thienuy.edu.vn`, loopback API ports, private worker port/socket, CSP, HSTS, `frame-ancestors 'none'`, request ID forwarding, ingest body limit 64 KiB, UI/API body limit, no wildcard CORS, and all SQL flags false.

- [ ] **Step 2: Implement PM2 topology**

Define `ops-api`, `ops-processor`, `ops-notifier`, and `ops-sql-worker` with separate log files, memory limits, graceful kill timeout, source maps, and independent environment namespaces. SQL worker starts but refuses production connection while flags/gates are false.

- [ ] **Step 3: Implement immutable release activation**

Stage `/srv/edutrack-ops/releases/<release-id>`, verify source/artifact hashes, atomically switch `/srv/edutrack-ops/current`, restart only Ops PM2 processes, run local/public health, and atomically restore the prior symlink on failure.

- [ ] **Step 4: Verify independence**

With user app stopped and production DB network blocked, require Ops login, audit, Overview, liveness, and runbooks to work. With Ops stopped, require the user app to remain healthy.

- [ ] **Step 5: Protect the Ops database independently**

Add pgBackRest stanza `edutrack_ops` to the separate backup host, continuous WAL with `archive_timeout=300s`, encrypted daily differential/weekly full backups, and a monthly isolated restore drill. The restore script must reject the live Ops database/server identity, verify migrations, audit-chain continuity, issue/incident counts, and encrypted object references. This Ops-database objective is RPO <= 5 minutes and RTO <= 60 minutes; it does not replace the stricter production-database objective.

- [ ] **Step 6: Run verification and commit**

```bash
npx vitest run deploy/vps/validate-environment.test.ts
npx vitest run deploy/vps/ops-backup.test.ts
shellcheck deploy/vps/activate-release.sh
shellcheck deploy/vps/backup-ops-postgres.sh deploy/vps/restore-ops-postgres-drill.sh
npm run typecheck
npm test
npm run build
git add deploy docs/runbooks/ops-deployment.md
git commit -m "feat(deploy): release independent man operations plane"
```

**Exit gate:** `man` is deployed with one MFA-enrolled owner, all security/audit checks pass, user/Ops failures are isolated, and every SQL feature flag remains disabled.
