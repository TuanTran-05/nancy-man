# EduTrack Ops Hardening and Production Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the complete Ops Plane meets security, privacy, performance, capture, recovery, and failure-isolation requirements, then activate production capabilities in controlled stages with evidence and on-call runbooks.

**Architecture:** Treat rollout flags and recovery/audit health as server-side gates. Add static policy checks, adversarial security suites, load/retention tests, synthetic canaries, and failure-injection drills across both repositories. Deploy dark, observe each capability, and expand only when its explicit gate remains green.

**Tech Stack:** TypeScript, Vitest, Playwright, k6, PostgreSQL 16, PM2, Nginx, pgBackRest, systemd/cron, OpenSSL, age, Zalo/SMTP test adapters.

**Spec:** `docs/superpowers/specs/2026-08-22-edutrack-ops-plane-design.md`

## Global Constraints

- Plan approval does not authorize production mutation, credential issuance, DNS change, alerting real recipients, standby promotion, or PITR cutover; each has an operational checkpoint.
- No gate may be bypassed with a browser/API request parameter.
- A failed/expired DR gate disables DML/DDL/break-glass immediately; a failed off-host audit anchor disables privileged SQL immediately.
- Synthetic tests never mutate business data and are tagged/excluded from customer-impact counts.
- Load tests never target production without separate approval and strict rate/identity safeguards.
- Test evidence contains IDs, timings, hashes, counts, and statuses, not secrets, raw PII, SQL parameters, or production result rows.
- Rollout flags are false in source defaults and enabled only in production secret/configuration state.

---

### Task 1: Define repository security policy and static guardrails

**Files:**
- Create: `edutrack-ops/SECURITY.md`
- Create: `edutrack-ops/scripts/check-security-boundaries.mjs`
- Create: `edutrack-ops/scripts/check-security-boundaries.test.mjs`
- Create: `edutrack-ops/scripts/check-secret-artifacts.mjs`
- Create: `edutrack-ops/scripts/check-secret-artifacts.test.mjs`
- Modify: `edutrack-ops/package.json`
- Modify: `edutrack-ops/.github/workflows/ci.yml`
- Create: `edutrack/scripts/check-error-capture.mjs`
- Create: `edutrack/scripts/check-error-capture.test.mjs`
- Modify: `edutrack/package.json`
- Modify: `edutrack/.github/workflows/ci.yml`

**Interfaces:**
- Produces: CI-enforced security boundaries, artifact secret scan, and telemetry-capture policy.

- [ ] **Step 1: Write explicit `SECURITY.md` invariants**

Document trust boundaries, separate identities, protected `_ops` schema, worker credential classes, off-host audit, sanitization, result/source-map authorization, recovery/cutover policy, accepted risk for full raw SQL, and out-of-scope `dev` system.

- [ ] **Step 2: Write RED boundary tests**

Fail if browser packages import Node/DB/secrets, API imports production DB client, non-worker code references production SQL credential names, worker exposes TCP/public listener, code introduces `skipAudit|skipPreview|skipJournal|skipRestore`, or plaintext secret names appear in client bundles.

- [ ] **Step 3: Write secret-artifact tests**

Scan build artifacts/source maps/test reports for database URLs, Bearer/JWT/private keys, known fixture secrets, `.env` content, OTP/password/cookie names with values, and production host credential patterns. Allow explicit safe `.env.example` placeholders only.

- [ ] **Step 4: Enforce app error-capture contract**

Fail on new direct `console.error`/unhandled catch blocks in business source except allowlisted logger/telemetry/process bootstrap/test files. Require ErrorBoundary, global browser listeners, Express final capture, job boundary, and synthetic canary registrations.

- [ ] **Step 5: Run and commit in each repository**

```bash
node scripts/check-security-boundaries.mjs
node scripts/check-secret-artifacts.mjs
npm test
git add SECURITY.md scripts package.json .github/workflows/ci.yml
git commit -m "chore(security): enforce ops trust boundaries in ci"
```

In `edutrack`, run its capture checker and commit separately.

---

### Task 2: Add adversarial authentication, ingestion, artifact, and SQL tests

**Files:**
- Create: `edutrack-ops/e2e/security-auth.spec.ts`
- Create: `edutrack-ops/e2e/security-ingest.spec.ts`
- Create: `edutrack-ops/e2e/security-artifacts.spec.ts`
- Create: `edutrack-ops/e2e/security-sql.spec.ts`
- Create: `edutrack-ops/test/security/sql-corpus.ts`
- Create: `edutrack-ops/test/security/secret-corpus.ts`
- Create: `edutrack-ops/test/security/securityMatrix.test.ts`

**Interfaces:**
- Produces: repeatable security regression matrix and redacted evidence.

- [ ] **Step 1: Implement auth/session matrix**

Test credential stuffing/rate limits/account lockout resistance, session fixation/rotation/revoke, cookie attributes, CSRF, CORS/Origin/Fetch-Site, WebAuthn challenge/replay/counter, TOTP/recovery code replay, elevation expiry, role matrix, cross-domain user/ESP/Ops cookies, and account recovery.

- [ ] **Step 2: Implement ingestion/artifact matrix**

Test HMAC/nonce/replay/skew, forged signed browser identity, public-key abuse, rate limits, oversized/deep/circular payloads, decompression/content-type confusion, sanitizer corpus, source-map/result/journal authorization, object-key traversal, presigned URL expiry, and cache headers.

- [ ] **Step 3: Implement SQL adversarial corpus**

Test comments/dollar quotes/Unicode/stacked statements/writable CTE, `COPY PROGRAM`, `DO/CALL`, role/session replication, trigger/journal changes, extension/system/database/replication, parser unsupported syntax, classifier bypass, request tamper, preview reuse/drift, PID reuse cancel, encrypted artifact tamper, and wrong database identity.

- [ ] **Step 4: Verify audit evidence for attacks**

Expected rejections create bounded security events/audit where appropriate, never echo secret/raw SQL values, and do not create alert recursion/storm.

- [ ] **Step 5: Prove `dev` cannot reach production writes**

From the `dev.thienuy.edu.vn` host/network identity, verify production PostgreSQL TCP is rejected by firewall/`pg_hba.conf`, no production database or Ops mutation credential exists in its secret/environment inventory, and an attempted connection with a deliberately invalid credential cannot reach PostgreSQL authentication. Record network rule IDs and rejection status only. Repeat after every production DB network-rule change.

- [ ] **Step 6: Run and commit**

```bash
npm run test:e2e -- security-auth security-ingest security-artifacts security-sql
npx vitest run test/security
git add e2e test/security
git commit -m "test(security): exercise ops plane adversarial boundaries"
```

---

### Task 3: Establish performance, capacity, and backpressure gates

**Files:**
- Create: `edutrack-ops/loadtests/ingest.js`
- Create: `edutrack-ops/loadtests/error-inbox.js`
- Create: `edutrack-ops/loadtests/sql-read.js`
- Create: `edutrack-ops/loadtests/thresholds.ts`
- Create: `edutrack-ops/loadtests/thresholds.test.ts`
- Create: `edutrack-ops/apps/processor/src/jobs/capacityHealth.ts`
- Create: `edutrack-ops/apps/processor/src/jobs/capacityHealth.test.ts`
- Create: `edutrack-ops/docs/runbooks/capacity.md`

**Interfaces:**
- Produces: load thresholds, queue/partition/object/WAL capacity alerts, and safe backpressure behavior.

- [ ] **Step 1: Define measurable thresholds**

On production-like infrastructure:

- ingest sustained 100 events/s for five minutes, p95 <= 250 ms, zero accepted-event loss;
- burst 500 events/s for 30 seconds degrades with bounded `429`, not process/DB collapse;
- issue list p95 <= 500 ms for 1 million occurrences/10,000 issues;
- processor backlog returns below one minute within ten minutes after burst;
- Critical processing-to-alert p95 <= 60 seconds;
- read query overhead outside PostgreSQL execution <= 200 ms;
- Ops DB, object store, local spool, WAL repo, and journal forecast at least 30 days before exhaustion.

- [ ] **Step 2: Write threshold evaluator tests**

Fail on accepted-event mismatch, latency/error threshold, unbounded memory, queue growth, partition/index bloat limit, or capacity forecast below minimum.

- [ ] **Step 3: Implement load scenarios**

Use synthetic sanitized events and disposable SQL fixtures. Include duplicate IDs, mixed fingerprints/releases, source-map hits/misses, alert candidates, SSE clients, slow object store, and slow database. Never point k6 to production by default.

- [ ] **Step 4: Implement capacity health**

Report partition sizes/age, issue/event rate, dead letters, processor lag, alert queue, object bucket bytes, journal backlog/export age, local spool bytes, WAL archive age/repository capacity, and standby lag.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run loadtests/thresholds.test.ts apps/processor/src/jobs/capacityHealth.test.ts
k6 run loadtests/ingest.js
k6 run loadtests/error-inbox.js
k6 run loadtests/sql-read.js
git add loadtests apps/processor/src/jobs/capacityHealth.ts apps/processor/src/jobs/capacityHealth.test.ts docs/runbooks/capacity.md
git commit -m "test(perf): enforce ops throughput and capacity gates"
```

---

### Task 4: Automate retention, privacy review, and cryptographic lifecycle

**Files:**
- Modify: `edutrack-ops/apps/processor/src/jobs/retention.ts`
- Create: `edutrack-ops/apps/processor/src/jobs/retention.integration.test.ts`
- Create: `edutrack-ops/apps/processor/src/jobs/keyRotation.ts`
- Create: `edutrack-ops/apps/processor/src/jobs/keyRotation.test.ts`
- Create: `edutrack-ops/scripts/audit-telemetry-privacy.ts`
- Create: `edutrack-ops/scripts/audit-telemetry-privacy.test.ts`
- Create: `edutrack-ops/docs/runbooks/privacy-and-retention.md`

**Interfaces:**
- Produces: policy-exact deletion/partition rotation, legal/incident holds, key rotation, and recurring privacy sampling.

- [ ] **Step 1: Write retention integration tests**

At simulated dates, drop only raw/event partitions older than 90 days; retain issues/incidents/activity/audit for two years; delete unreferenced maps; keep recovery artifacts 90 days; enforce holds; clean production journal only after verified export and at most seven days.

- [ ] **Step 2: Implement key/version rotation**

Rotate envelope-wrapping keys without decrypting into logs/disk, rewrap data keys, retain old key versions until no object references them, and support cryptographic erasure of expired artifacts. Session/HMAC/ingest keys have overlapping rotation windows and explicit client revoke.

- [ ] **Step 3: Implement privacy audit**

Sample sanitized searchable fields using patterns/hashes and fixture canaries, not manual export of full production payload. Any match creates Critical privacy issue, freezes export/reveal endpoints, preserves evidence, and invokes runbook.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run apps/processor/src/jobs/retention.integration.test.ts apps/processor/src/jobs/keyRotation.test.ts scripts/audit-telemetry-privacy.test.ts
git add apps/processor/src/jobs scripts docs/runbooks/privacy-and-retention.md
git commit -m "feat(privacy): enforce telemetry retention and key rotation"
```

---

### Task 5: Build failure-injection and availability drills

**Files:**
- Create: `edutrack-ops/test/chaos/scenarios.ts`
- Create: `edutrack-ops/test/chaos/runScenario.ts`
- Create: `edutrack-ops/test/chaos/runScenario.test.ts`
- Create: `edutrack-ops/docs/runbooks/ops-service-outage.md`
- Create: `edutrack-ops/docs/runbooks/audit-anchor-outage.md`
- Create: `edutrack-ops/docs/runbooks/notification-outage.md`
- Create: `edutrack-ops/docs/runbooks/ops-database-recovery.md`

**Interfaces:**
- Produces: signed failure-behavior evidence for every availability row in the spec.

- [ ] **Step 1: Define scenario expectations**

```ts
export const scenarios = {
  collector_down: { userTraffic: 'healthy', sourceSpool: 'growing_bounded' },
  processor_down: { rawEvents: 'durable', inboxLag: 'alerted' },
  notifier_down: { issue: 'provider_failure', alternateChannel: 'attempted' },
  productionDbDown: { opsLogin: 'healthy', sql: 'disabled', recovery: 'available' },
  opsDbDown: { mutation: 'blocked', sourceSpool: 'growing_bounded' },
  auditHostDown: { mutation: 'blocked', readSql: 'degraded_allowed' },
  sqlWorkerDown: { errors: 'healthy', sql: 'unavailable' },
  opsHostDown: { userTraffic: 'healthy', sourceSpool: 'growing_bounded' },
} as const;
```

- [ ] **Step 2: Write runner safety tests**

Require explicit non-production target by default, scenario allowlist, maximum duration, automatic cleanup, pre/post health snapshot, and refusal to kill/modify a production process without an approval token supplied outside Git.

- [ ] **Step 3: Execute production-like chaos drills**

Inject network refusal/latency, stop each process, revoke DB/object/audit access, fill spool near quota, corrupt a source-map object copy, and fail one alert provider. Verify exact behavior, dedup, recovery, and no user-app dependency.

- [ ] **Step 4: Run approved limited production drills**

Use a maintenance window and reversible process/network controls. Never stop primary PostgreSQL or promote standby as part of this task; those remain DR-plan exercises.

- [ ] **Step 5: Commit tooling/runbooks**

```bash
npx vitest run test/chaos/runScenario.test.ts
git add test/chaos docs/runbooks
git commit -m "test(resilience): verify ops failure isolation"
```

---

### Task 6: Automate synthetic canary and release smoke gates

**Files:**
- Create: `edutrack-ops/scripts/run-error-canary.ts`
- Create: `edutrack-ops/scripts/run-error-canary.test.ts`
- Create: `edutrack-ops/scripts/run-sql-canary.ts`
- Create: `edutrack-ops/scripts/run-sql-canary.test.ts`
- Create: `edutrack-ops/deploy/vps/run-release-smoke.sh`
- Create: `edutrack-ops/deploy/vps/systemd/ops-canary.service`
- Create: `edutrack-ops/deploy/vps/systemd/ops-canary.timer`
- Modify: `edutrack-ops/deploy/vps/activate-release.sh`

**Interfaces:**
- Produces: end-to-end error/alert/source-map and safe SQL read canaries before/after every release plus scheduled watchdog evidence.

- [ ] **Step 1: Write canary tests**

Error canary passes only when browser/API/database/job/provider synthetic occurrences are grouped, symbolicated, correlated, and required test alert delivered. SQL canary uses `SELECT` only, verifies production identity/read-only mode/audit/history/cancel, and never enables mutation flags.

- [ ] **Step 2: Implement canaries with bounded polling**

Generate unique canary run ID, poll by ID with 60-second deadline, verify expected fields/delivery, resolve synthetic issues automatically with activity, and emit redacted JSON evidence.

- [ ] **Step 3: Add release rollback gate**

Activation runs liveness/readiness/migrations/error canary/SQL read canary. Failure atomically returns to prior Ops release and keeps existing feature flags unchanged. Canary must not page real recipients; use the dedicated test delivery target.

- [ ] **Step 4: Schedule independent watchdog**

Run every five minutes from the backup/audit host or another independent host. If `man` cannot ingest/respond, alert through a channel that does not depend on Ops notifier.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run scripts/run-error-canary.test.ts scripts/run-sql-canary.test.ts
shellcheck deploy/vps/run-release-smoke.sh deploy/vps/activate-release.sh
git add scripts deploy/vps
git commit -m "feat(operations): gate releases with end to end canaries"
```

---

### Task 7: Finalize runbooks, on-call workflow, and audit evidence

**Files:**
- Create: `edutrack-ops/docs/runbooks/incident-response.md`
- Create: `edutrack-ops/docs/runbooks/critical-alert.md`
- Create: `edutrack-ops/docs/runbooks/maintenance-account-recovery.md`
- Create: `edutrack-ops/docs/runbooks/credential-rotation.md`
- Create: `edutrack-ops/docs/runbooks/source-map-release.md`
- Create: `edutrack-ops/docs/runbooks/index.md`
- Create: `edutrack-ops/docs/checklists/on-call-training.md`
- Create: `edutrack-ops/docs/checklists/production-activation.md`

**Interfaces:**
- Produces: role-specific procedures and signed readiness review.

- [ ] **Step 1: Write complete runbooks**

Each runbook contains trigger, severity/owner, prerequisites, exact safe commands/actions, expected output, stop/rollback conditions, evidence to retain, escalation, and post-incident steps. Never put credentials or production URLs with embedded secrets in docs.

- [ ] **Step 2: Conduct tabletop exercises**

At minimum: broad login error, student data correction, wrong mass update, DROP table, database host loss, collector outage, privacy leak, compromised Ops account, lost owner MFA, audit-anchor mismatch, Zalo outage, and expired DR gate.

- [ ] **Step 3: Train each role**

Viewer demonstrates issue triage; maintainer demonstrates SQL read/DML preview/reverse conflict; owner demonstrates account recovery, alert config, DDL/PITR authorization, and sealed break-glass without exposing credential.

- [ ] **Step 4: Sign readiness checklist**

Record release SHAs, migration/role hashes, environment flag values (not secrets), DR evidence hash/expiry, security/load/chaos/canary results, backup/standby health, rollback release, and named decision makers.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/runbooks docs/checklists
git commit -m "docs(operations): complete ops plane on call procedures"
```

---

### Task 8: Execute staged production activation and final verification

**Files:**
- Verify: all code, migration, deploy, tests, runbooks, and evidence produced by the full plan set.
- Store privately, not Git: signed activation/observation evidence.

**Interfaces:**
- Consumes: complete implementation and green gates.
- Produces: controlled production rollout and final acceptance mapping.

- [ ] **Step 1: Deploy foundation only**

All SQL flags false; ingest keys disabled. Enroll first owner, verify independent login/audit/health/rollback, observe 48 hours.

- [ ] **Step 2: Dark-launch error ingestion**

Enable ingest clients and processor, keep real alerts disabled, run seven days, review sanitizer samples/fingerprint/cardinality/capacity, and require all synthetic sources.

- [ ] **Step 3: Enable Critical/High alerting**

Send approved test, prove <= 60 seconds, dedup/reminder/escalation/provider failure, then enable production rules.

- [ ] **Step 4: Enable SQL read-only for one maintainer**

Require role bypass suite and database identity. Observe seven days, review database load/history/artifact/cancel/audit, then expand.

- [ ] **Step 5: Enable DML for one maintainer**

Require current DR/audit gates. First execution is a bounded approved correction rehearsal followed by successful reverse. Observe 14 days with zero unjournaled/drifted commits.

- [ ] **Step 6: Enable transactional DDL**

Require destructive recovery drill and schema manifest. Observe every DDL and close its `SCHEMA_DRIFT` only through source migration or restore.

- [ ] **Step 7: Enable sealed break-glass last**

Require owner-only credential broker/off-host receipt exercise and a separate activation signature. Keep credential inaccessible to normal PM2 environment.

- [ ] **Step 8: Map acceptance criteria to evidence**

Create a matrix with every section 24 criterion in the spec and an exact evidence file/test/drill/metric. Any missing/failed mapping blocks completion.

- [ ] **Step 9: Run final repository verification**

In both repositories:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
```

Also run the existing app's VPS/ESP builds, schema preflight, error canary, Ops security/load/chaos suites, DR gate verifier, and audit-chain verifier.

- [ ] **Step 10: Complete review and integration**

Invoke `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`, then `superpowers:finishing-a-development-branch`. Resolve every correctness/security/recovery finding before merge or account expansion.

**Exit gate:** all acceptance criteria have current evidence, every rollout stage passed its observation window, RPO/RTO and alert SLO are measured, no known PII/secret leakage exists, and rollback/incident/account recovery procedures have been exercised by the actual operators.
