# EduTrack Operations Plane Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an independent, self-hosted operations plane at `man.thienuy.edu.vn` with complete error operations and a controlled production PostgreSQL console, backed by measured RPO <= 60 seconds and RTO <= 15 minutes.

**Architecture:** Implement a separate `edutrack-ops` repository containing web, API, processor, notifier, and private SQL-worker applications. Integrate a versioned telemetry SDK into the existing `edutrack` repository. Establish continuous PostgreSQL recovery before enabling production writes, then roll out Error Operations, read-only SQL, DML recovery, DDL/break-glass, and hardening in gated order.

**Tech Stack:** Node.js 22.22+, TypeScript 5.8, React 19, Vite 6, Express 5, PostgreSQL 16, Drizzle ORM 0.45, Vitest 4, Playwright 1.59, PM2, Nginx, pgBackRest, MinIO/S3-compatible self-hosted object storage, Zalo Bot/OA adapter, SMTP email.

**Spec:** `docs/superpowers/specs/2026-08-22-edutrack-ops-plane-design.md`

## Global Constraints

- `man.thienuy.edu.vn` uses separate accounts, sessions, database, secrets, and deployment from EduTrack.
- `dev.thienuy.edu.vn` and all test/staging tooling are outside this program and must have no production write route.
- Production SQL credentials never enter browser code, API responses, logs, source maps, or CI artifacts.
- No production SQL mutation is enabled until measured DR drills prove RPO <= 60 seconds and RTO <= 15 minutes.
- Raw SQL includes DML, DDL, cluster-level, and unparsed break-glass operations, but each class uses its specified database role, MFA, audit, and recovery gate.
- Error capture is fail-open for user traffic and fail-closed for secrets: telemetry outage never fails a user request; unsanitized payload is never spooled or sent.
- DML cannot commit when required row-journal evidence is absent or the approved preview checksum has drifted.
- DDL/PITR cannot automatically cut over a restored database; verification and explicit human confirmation are mandatory.
- All source maps, SQL/result artifacts, and recovery images are private and encrypted.
- Each task uses RED/GREEN tests, focused verification, and a small commit. Operational production mutation requires its own approval even when the plan is approved.
- The source snapshot used to write this plan has no Git metadata. At execution time, use canonical Git checkouts and invoke `superpowers:using-git-worktrees` before code changes.

## Repository map

```text
edutrack/                         existing user application repository
  src/                            staff/ESP browser integration
  server/                         Express/database/job integration
  db/                             production _ops migration and schema checks
  deploy/vps/                     release, Nginx, source-map and spool config

edutrack-ops/                     new independent repository
  apps/web/                       React maintenance UI
  apps/api/                       auth, ingestion, issues, SQL orchestration, SSE
  apps/processor/                 grouping, source maps, retention, regression
  apps/notifier/                  Zalo/email delivery and escalation
  apps/sql-worker/                private PostgreSQL execution/recovery worker
  packages/contracts/             versioned HTTP/telemetry/SQL contracts
  packages/db/                    Ops Drizzle schema, migrations, repositories
  packages/security/              sanitizer, encryption, audit chain, auth primitives
  deploy/                         PM2, Nginx, backup, service and release assets
  docs/runbooks/                  login recovery, incident, SQL and DR procedures
```

## Plan set and dependency gates

1. `2026-08-22-edutrack-ops-dr-foundation.md` — continuous WAL, backup host, standby, isolated restore, drills.
2. `2026-08-22-edutrack-ops-foundation.md` — repository, Ops DB, auth/MFA/RBAC, audit anchor, deployment, base shell.
3. `2026-08-22-edutrack-error-operations.md` — contracts/SDK, ingestion, processor, Inbox, release/source maps, alerts, app integration.
4. `2026-08-22-edutrack-ops-database-readonly.md` — private worker, schema browser, classifier, read-only SQL/history/cancel.
5. `2026-08-22-edutrack-ops-database-mutations-recovery.md` — `_ops` journal, DML preview/execute/reverse, DDL, selective restore, PITR, break-glass.
6. `2026-08-22-edutrack-ops-hardening-rollout.md` — end-to-end security/performance/chaos verification and staged production activation.

```text
DR gate ───────────────┐
                      ▼
Ops foundation -> Error dark launch -> Alerts
        │
        └-> SQL read-only -> DML -> DDL/PITR -> break-glass
                                      │
                                      ▼
                            hardening + 14-day review
```

---

### Task 1: Establish canonical workspaces and evidence baseline

**Files:**
- Verify: `docs/superpowers/specs/2026-08-22-edutrack-ops-plane-design.md`
- Verify: the six subplans listed above.
- Do not commit: `scratch/ops-baseline/`

**Interfaces:**
- Consumes: approved spec and canonical Git repositories selected for implementation.
- Produces: source SHAs, clean worktrees, test/build/schema baselines, and assigned operational owners.

- [ ] **Step 1: Create isolated worktrees**

Invoke `superpowers:using-git-worktrees` for `edutrack` branch `codex/ops-telemetry` and `edutrack-ops` branch `codex/ops-plane`. Confirm both `git status --short` outputs are empty.

- [ ] **Step 2: Put the approved spec and plans under version control**

Copy `/home/deploy/docs/superpowers/specs/2026-08-22-edutrack-ops-plane-design.md` and all `/home/deploy/docs/superpowers/plans/2026-08-22-edutrack-*.md` files into the same relative `docs/superpowers/{specs,plans}/` paths in `edutrack-ops`. Verify SHA-256 equality before committing; the implementation spec must travel with the repository and every subplan's `Spec:` path must resolve.

- [ ] **Step 3: Capture the existing application baseline**

```bash
mkdir -p scratch/ops-baseline
git rev-parse HEAD > scratch/ops-baseline/edutrack-sha.txt
npm run typecheck 2>&1 | tee scratch/ops-baseline/typecheck.txt
npm test 2>&1 | tee scratch/ops-baseline/tests.txt
npm run build:vps 2>&1 | tee scratch/ops-baseline/build.txt
node db/preflight/00-validate-schema.mjs db/migrations 2>&1 | tee scratch/ops-baseline/schema.txt
```

Expected: all commands exit `0`; baseline failures are resolved or explicitly isolated before Ops code is attributed to them.

- [ ] **Step 4: Record non-secret infrastructure ownership**

Create a private operations record naming the production DB host, Ops host, backup host, standby host, DNS owner, Zalo recipient/group, SMTP recipient/group, primary on-call, and recovery decision maker. Record identifiers and owners only; credentials remain in secret storage.

- [ ] **Step 5: Commit plan documents but no baseline artifacts**

Confirm `scratch/` is ignored and contains no secret values. Commit the copied design/plan set as `docs: add approved operations plane program`.

---

### Task 2: Complete the disaster-recovery prerequisite

**Files:**
- Follow: `docs/superpowers/plans/2026-08-22-edutrack-ops-dr-foundation.md`

**Interfaces:**
- Consumes: production PostgreSQL 16, current logical backup scripts, separate backup/standby infrastructure.
- Produces: continuous WAL archive, warm standby, isolated recovery target, signed drill evidence, and a hard `mutationEnabled` gate.

- [ ] **Step 1: Execute every DR plan task in order**

Do not begin SQL mutation development against production credentials while DR tasks are incomplete. Development uses disposable PostgreSQL only.

- [ ] **Step 2: Review measured results**

Require evidence for single-row recovery, mass delete, truncate, drop table, primary-host loss, backup-host outage, and wrong-target guard. The measured maximum must satisfy both objectives.

- [ ] **Step 3: Approve the DR gate**

Store signed evidence and set the Ops configuration gate only after review:

```text
OPS_SQL_MUTATION_ENABLED=false  # committed/default configuration
```

The production secret/configuration override remains `false` until Task 6 rollout explicitly changes it.

---

### Task 3: Build and deploy Ops foundation

**Files:**
- Follow: `docs/superpowers/plans/2026-08-22-edutrack-ops-foundation.md`

**Interfaces:**
- Consumes: independent host, Ops database/object storage, TLS/DNS, backup audit receiver.
- Produces: authenticated `man`, RBAC, MFA/elevation, append-only audit, health dashboard, CI/CD, and private process topology.

- [ ] **Step 1: Complete foundation code and tests**

Execute repository, schema, auth, audit, API security, web shell, and deployment tasks.

- [ ] **Step 2: Perform independent-failure verification**

Stop the user application and deny the Ops host access to production PostgreSQL. Confirm Ops login, audit view, runbooks, and health degradation remain functional.

- [ ] **Step 3: Security review before inviting accounts**

Invoke `superpowers:requesting-code-review`; block on session, MFA, CSRF, secret, account recovery, or audit-anchor findings.

**Exit gate:** first `ops_owner` enrolled through offline bootstrap; no maintainer account yet has production SQL elevation.

---

### Task 4: Dark-launch Error Operations

**Files:**
- Follow: `docs/superpowers/plans/2026-08-22-edutrack-error-operations.md`

**Interfaces:**
- Consumes: Ops foundation, versioned telemetry contracts, existing EduTrack browser/API/jobs/providers.
- Produces: durable sanitized error pipeline, issue workflow, source-mapped releases, alerts, and synthetic canaries.

- [ ] **Step 1: Land contracts and ingestion before app instrumentation**

Collector schema/idempotency/sanitizer tests must pass before a source can send production events.

- [ ] **Step 2: Instrument sources in controlled batches**

Order: API/request context -> server capture/spool -> jobs/providers/database/document store -> staff browser -> ESP browser -> deployment canary.

- [ ] **Step 3: Run dark for seven days**

Keep outbound Critical/High alerts disabled while tuning fingerprint, rate limits, PII sanitizer, and issue volume. Canary failures still alert through the independent watchdog channel.

- [ ] **Step 4: Enable alert policy**

Require Critical delivery <= 60 seconds, five-minute High deduplication, reminder/escalation, and provider-failure issue generation.

**Exit gate:** all synthetic sources reach Inbox with correct user/time/request/release and no known secret/PII leakage.

---

### Task 5: Enable read-only Database Console

**Files:**
- Follow: `docs/superpowers/plans/2026-08-22-edutrack-ops-database-readonly.md`

**Interfaces:**
- Consumes: Ops auth/audit, production TLS route, `ops_readonly` database role.
- Produces: schema browser, read-only SQL, classification, result limits, cancellation, artifacts, history, and issue linking.

- [ ] **Step 1: Complete worker and UI behind disabled flag**

Committed default remains:

```text
OPS_SQL_READ_ENABLED=false
```

- [ ] **Step 2: Prove defense in depth**

Bypass the classifier in an integration test and directly submit `INSERT`, `UPDATE`, `DELETE`, and `DDL` through the read runner. PostgreSQL must reject every mutation because the transaction and database role are read-only.

- [ ] **Step 3: Enable one maintainer**

Turn on read-only SQL for one named account, review query history/timeout/cancel/result redaction after seven normal operating days, then expand if clean.

---

### Task 6: Enable DML and recovery

**Files:**
- Follow DML/reverse/selective tasks in `docs/superpowers/plans/2026-08-22-edutrack-ops-database-mutations-recovery.md`

**Interfaces:**
- Consumes: approved DR gate, read-only console, `_ops` migration, `ops_dml` role.
- Produces: impact preview, drift detection, row journal, DML commit gate, reverse recovery, selective repair, and verification.

- [ ] **Step 1: Drill on restored production-shaped data**

Test insert/update/delete, cascades, constraints, triggers, concurrent edits, worker termination before commit, and reverse conflicts.

- [ ] **Step 2: Obtain production-mutation activation approval**

Present exact release SHA, database-role grants, migration checksum, DR evidence, audit-anchor health, rollback runbook, and named first maintainer.

- [ ] **Step 3: Activate for one maintainer**

Set `OPS_SQL_MUTATION_ENABLED=true` only after approval. First production execution is a harmless, bounded correction rehearsal with an immediate reverse drill and incident link.

- [ ] **Step 4: Review for 14 days**

Require zero unjournaled commit, zero preview-drift commit, complete off-host receipts, and successful recovery artifact export.

---

### Task 7: Enable DDL, PITR, and break-glass

**Files:**
- Follow DDL/PITR/break-glass tasks in `docs/superpowers/plans/2026-08-22-edutrack-ops-database-mutations-recovery.md`

**Interfaces:**
- Consumes: stable DML operation, schema manifest, sealed privileged credential, isolated PITR target.
- Produces: schema snapshots/drift, transactional DDL, non-transactional runner, selective/PITR orchestration, and cluster-level break-glass.

- [ ] **Step 1: Prove destructive recovery before enabling controls**

Rehearse `TRUNCATE`, `DROP TABLE`, incompatible `ALTER`, schema drift, and primary loss. Full PITR must refuse automatic cutover on any failed verification.

- [ ] **Step 2: Activate capabilities in separate flags**

```text
OPS_SQL_DDL_ENABLED=true
OPS_SQL_BREAK_GLASS_ENABLED=false
```

Run transactional DDL observation first. Enable break-glass only after a separate owner review of credential sealing and off-host receipts.

- [ ] **Step 3: Require source migration reconciliation**

Every manual DDL opens `SCHEMA_DRIFT` and remains unresolved until the equivalent source-controlled migration/manifest is deployed or production is restored to the manifest.

---

### Task 8: Complete hardening and program verification

**Files:**
- Follow: `docs/superpowers/plans/2026-08-22-edutrack-ops-hardening-rollout.md`

**Interfaces:**
- Consumes: all implemented services and production gates.
- Produces: security/performance/chaos evidence, runbooks, on-call training, retention jobs, final review, and integration-ready branches.

- [ ] **Step 1: Run static and automated verification in both repositories**

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
```

Expected: each repository's declared commands exit `0`; no success claim is based on partial focused tests alone.

- [ ] **Step 2: Run production-like failure exercises**

Exercise collector, Ops DB, SQL worker, production DB, backup host, notifier, and full Ops-host failures. Verify the failure matrix in the spec.

- [ ] **Step 3: Verify acceptance criteria**

Map every spec acceptance criterion to a test report, drill record, query/audit evidence, or monitoring result. Any unmapped criterion blocks completion.

- [ ] **Step 4: Final review and branch handoff**

Invoke `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`, then `superpowers:finishing-a-development-branch`. Resolve findings before merge or production expansion.
