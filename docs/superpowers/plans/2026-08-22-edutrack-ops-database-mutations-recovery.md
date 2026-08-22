# EduTrack Ops Database Mutations and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely enable production raw DML, DDL, non-transactional, cluster-level, and unparsed break-glass SQL with preview, row journaling, drift checks, audit anchors, reverse/selective/PITR recovery, and explicit verification.

**Architecture:** Add an isolated `_ops` schema and security-definer row journal to production, owned separately from application tables. The SQL worker selects database roles by classification. DML preview runs in a rollback transaction; the real transaction executes once, compares its actual journal checksum to the approved preview before commit, verifies invariants, and exports evidence. DDL and commands without safe reverse use restore points, schema snapshots, isolated PITR, and explicit cutover gates. A sealed superuser is used only for owner-authorized break-glass after an off-host receipt.

**Tech Stack:** PostgreSQL 16, TypeScript/Node.js 22, `pg`, `pgsql-ast-parser`, Drizzle, React 19, CodeMirror 6, pgBackRest, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-22-edutrack-ops-plane-design.md`

## Global Constraints

- Production DML remains disabled until signed DR evidence is current and proves RPO <= 60 seconds and RTO <= 15 minutes.
- Default flags are `OPS_SQL_MUTATION_ENABLED=false`, `OPS_SQL_DDL_ENABLED=false`, and `OPS_SQL_BREAK_GLASS_ENABLED=false`.
- `ops_dml`, `ops_ddl`, and sealed break-glass credentials are separate. The worker chooses; browser/API cannot choose a credential.
- `_ops` objects are owned by a dedicated NOLOGIN role. Application schema ownership never grants journal/audit modification.
- Registered-table DML cannot commit without complete journal evidence and an impact checksum equal to the approved preview.
- DML on an unregistered table is not mislabeled reversible; it is rejected from ordinary DML and can run only as `PITR_ONLY` break-glass after restore-point verification.
- Reverse recovery never overwrites a row changed after the original execution.
- DDL does not replace source-controlled migrations. Schema drift stays open until source and production converge.
- Non-transactional/cluster-level/unparsed execution never advertises one-click undo.
- Email/Zalo/payment/storage and other external effects are not reversed by database rollback.

---

### Task 1: Add the protected production `_ops` schema and journal roles

**Files:**
- Create: `edutrack/db/migrations/0022_ops_execution_journal.sql`
- Create: `edutrack/db/migrations/0022_ops_execution_journal.test.ts`
- Modify: `edutrack/db/drizzle/schema.ts`
- Modify: `edutrack/db/drizzle/relations.ts`
- Create: `edutrack-ops/deploy/postgres/002_ops_mutation_roles.sql`
- Create: `edutrack-ops/deploy/postgres/verify-journal-security.ts`
- Create: `edutrack-ops/deploy/postgres/verify-journal-security.test.ts`

**Interfaces:**
- Produces: `_ops.execution_registry`, `_ops.row_change_journal`, `_ops.journaled_tables`, journal trigger function, registration function, and role boundaries.

- [ ] **Step 1: Write migration RED tests**

Apply migrations through `0022` to disposable PostgreSQL and assert:

- `_ops` schema/tables/functions exist;
- journal rows contain execution ID, sequence, txid, schema/table, operation, primary-key JSON, old/new JSON, before/after hashes, actor, statement index, timestamp/LSN evidence;
- `ops.execution_id`, actor, and statement index are required for registered-table mutations through the Ops DML role;
- direct app runtime writes continue normally without Ops journaling;
- journal security-definer functions set a fixed safe `search_path`;
- app owner/ops roles cannot update/delete/truncate journal or alter its trigger function.

- [ ] **Step 2: Define tables and policies**

`_ops.journaled_tables` records schema/table, ordered primary-key columns, enabled flag, row-size policy, post-check policy, and registration time. Register all physical business tables with primary keys, excluding append-only audit/history tables and `_ops`; output an explicit list of exclusions and recovery class.

- [ ] **Step 3: Implement security-definer trigger**

Use `to_jsonb(OLD/NEW)`, ordered primary-key JSON, and SHA-256 digest through `pgcrypto`. Trigger owner is `ops_journal_owner` NOLOGIN. Revoke PUBLIC execute, fix `search_path=pg_catalog,_ops`, and allow only trigger execution/registration through controlled migration.

- [ ] **Step 4: Provision mutation/DDL roles**

- `ops_dml`: INSERT/UPDATE/DELETE on registered business tables, sequence usage, no schema ownership, no `_ops` write.
- `ops_ddl`: member of the application schema-owner role, but not journal owner; no superuser/role/replication/system privilege.
- `ops_breakglass_login`: sealed superuser credential not present in normal worker environment; loaded only by a one-shot credential broker after receipt approval.

- [ ] **Step 5: Prove journal security**

Attempt `DISABLE TRIGGER`, `_ops` DML/DDL, `SET session_replication_role`, owner escalation, and function replacement as `ops_dml`/`ops_ddl`. Require rejection except where an application-table DDL is intentionally allowed.

- [ ] **Step 6: Run and commit in both repositories**

In `edutrack`:

```bash
npx vitest run db/migrations/0022_ops_execution_journal.test.ts
node db/preflight/00-validate-schema.mjs db/migrations
git add db/migrations/0022_ops_execution_journal.sql db/migrations/0022_ops_execution_journal.test.ts db/drizzle
git commit -m "feat(db): add protected ops row journal"
```

In `edutrack-ops`:

```bash
npx vitest run deploy/postgres/verify-journal-security.test.ts
git add deploy/postgres
git commit -m "feat(sql): provision mutation and ddl roles"
```

---

### Task 2: Implement mutation risk, recoverability, and confirmation policy

**Files:**
- Create: `edutrack-ops/apps/sql-worker/src/classifier/riskPolicy.ts`
- Create: `edutrack-ops/apps/sql-worker/src/classifier/riskPolicy.test.ts`
- Create: `edutrack-ops/packages/contracts/src/sqlRisk.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/confirmationPolicy.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/confirmationPolicy.test.ts`

**Interfaces:**
- Produces: `classifyRisk`, `requiredConfirmation`, and server-owned gates for execution.

- [ ] **Step 1: Define exact risk contract**

```ts
export type SqlRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ExecutionGate = {
  risk: SqlRisk;
  recoverability: 'REVERSIBLE' | 'PITR_ONLY' | 'NO_AUTOMATIC_UNDO';
  requiresRecentMfa: boolean;
  requiresRestorePoint: boolean;
  confirmationPhrase: string;
  warnings: string[];
};
```

- [ ] **Step 2: Write RED policy matrix**

Require High for UPDATE/DELETE without WHERE, >100 rows, >10% of a table, cascades >100, ALTER/DROP, and journal-policy warning. Require Critical for >1,000 rows, >25% of a table, TRUNCATE, DROP TABLE/SCHEMA, role/database/replication/system, trigger/journal bypass, and unparsed break-glass.

- [ ] **Step 3: Implement confirmation phrases**

- normal DML: `EXECUTE SQL_<id>`;
- High/Critical DML/DDL: `EXECUTE PRODUCTION SQL_<id>`;
- cluster/unparsed/journal bypass: `BREAK GLASS SQL_<id>`.

Compare normalized Unicode input exactly, expire after five minutes, bind to preview checksum/session/user, and reject copied confirmation for another execution.

- [ ] **Step 4: Enforce owner-only cases**

Only `ops_owner` may use cluster-level, unparsed, journal-bypass, `COPY PROGRAM`, unsafe extension, role/system, or `_ops` commands. Maintainer may use ordinary DML/transactional DDL after its gates.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/sql-worker/src/classifier/riskPolicy.test.ts apps/api/src/modules/sql/confirmationPolicy.test.ts
git add apps/sql-worker/src/classifier packages/contracts/src/sqlRisk.ts apps/api/src/modules/sql/confirmationPolicy.ts apps/api/src/modules/sql/confirmationPolicy.test.ts
git commit -m "feat(sql): classify mutation risk and confirmations"
```

---

### Task 3: Implement DML preview and impact checksum

**Files:**
- Create: `edutrack-ops/packages/contracts/src/sqlPreview.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/dmlPreview.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/dmlPreview.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/journalReader.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/journalReader.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/impactChecksum.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/impactChecksum.test.ts`
- Create: `edutrack-ops/packages/db/src/schema/sqlPreviews.ts`
- Create: `edutrack-ops/packages/db/migrations/0004_sql_mutation_preview.sql`

**Interfaces:**
- Produces: `previewDml(input): DmlImpactPreview` and canonical `computeImpactChecksum`.

- [ ] **Step 1: Define preview contract**

```ts
export type JournalChange = {
  sequence: string;
  schema: string;
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  primaryKey: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  beforeHash: string | null;
  afterHash: string | null;
  statementIndex: number;
};

export type DmlImpactPreview = {
  previewId: `PRV_${string}`;
  executionId: `SQL_${string}`;
  statements: SqlStatementInfo[];
  changes: JournalChange[];
  countsByTable: Record<string, number>;
  impactChecksum: string;
  triggerSummary: string[];
  risk: SqlRisk;
  recoverability: 'REVERSIBLE' | 'PITR_ONLY';
  expiresAt: string;
};
```

- [ ] **Step 2: Write preview tests**

Cover insert/update/delete, multi-statement batch, FK cascade, trigger-created rows, constraint failure, statement/lock timeout, missing WHERE, composite/string/number keys, null/JSON/date/bytea, sequence gaps after rollback, unregistered table, and external-effect trigger warning.

- [ ] **Step 3: Implement rollback preview transaction**

Connect as `ops_dml`, `BEGIN`, set local timeouts and `_ops` execution/actor/statement context, run each statement, read this transaction's journal, compute a canonical impact checksum from ordered table/operation/key/before hash/after hash, collect `EXPLAIN`/trigger metadata where safe, then `ROLLBACK` in every path.

- [ ] **Step 4: Persist encrypted preview**

Store actor/session, encrypted SQL, fingerprint, impact checksum, encrypted before/after artifact, counts, risk, and five-minute expiry. The API response can show authorized diff but search indexes no row value.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/sql-worker/src/execution/dmlPreview.test.ts apps/sql-worker/src/execution/journalReader.test.ts apps/sql-worker/src/execution/impactChecksum.test.ts packages/db/src
git add packages/contracts/src/sqlPreview.ts apps/sql-worker/src/execution packages/db
git commit -m "feat(sql): preview dml impact with row journal checksums"
```

---

### Task 4: Execute DML with drift, audit, restore, journal, and post-check gates

**Files:**
- Create: `edutrack-ops/apps/sql-worker/src/execution/dmlExecution.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/dmlExecution.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/postChecks.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/postChecks.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/mutationRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/mutationRoutes.test.ts`
- Modify: `edutrack-ops/packages/db/src/schema/sqlExecutions.ts`
- Create: `edutrack-ops/packages/db/migrations/0005_sql_mutation_execution.sql`

**Interfaces:**
- Produces: `executeApprovedDml(input): MutationExecutionResult` and `POST /api/v1/sql/execute`.

- [ ] **Step 1: Write RED gate tests**

Use this result contract:

```ts
export type MutationExecutionResult = {
  executionId: `SQL_${string}`;
  status: 'committed' | 'rolled_back' | 'drifted' | 'failed';
  impactChecksum: string;
  affectedRows: number;
  countsByTable: Record<string, number>;
  transactionId: string | null;
  walLsn: string | null;
  restorePointId: string | null;
  journalArtifactId: string | null;
  verificationIds: string[];
  failureCode: string | null;
};
```

Reject disabled feature flag, expired/wrong preview, wrong actor/session/SQL fingerprint, stale MFA, incorrect phrase, unhealthy/expired DR gate, failed audit receiver, failed restore point when required, missing journal, impact checksum drift, failed post-check, or production identity mismatch.

- [ ] **Step 2: Implement pre-execution orchestration**

Re-classify server-side, validate exact SQL fingerprint against preview, evaluate risk, verify current DR/audit health, anchor signed off-host intent, and create/archive-verify restore point when required. The browser cannot skip any step.

- [ ] **Step 3: Implement the single real transaction**

Connect as `ops_dml`, verify database/system identity, `BEGIN`, register execution and local context, run the statements once, read actual journal, compute impact checksum, compare with preview, run post-checks, then commit only if all pass. On mismatch/error, rollback and set status `drifted`/`failed`.

- [ ] **Step 4: Implement post-check registry**

Map affected table groups to parameterized checks: foreign keys/constraints, student identity links, enrollment/class consistency, finance ledger/balance/receipt totals, auth account/session state, job/outbox state, and schema verification where relevant. Unknown registered tables receive generic constraint and row-existence checks plus warning.

- [ ] **Step 5: Export journal and finalize audit**

After commit, record transaction/LSN evidence, encrypt/export journal artifact, verify digest/readback, add issue/incident activity, and append final audit. Keep production journal until export verified. A post-commit export failure creates Critical recovery-evidence issue; it cannot claim rollback of the already committed transaction.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run apps/sql-worker/src/execution/dmlExecution.test.ts apps/sql-worker/src/execution/postChecks.test.ts apps/api/src/modules/sql/mutationRoutes.test.ts
git add apps/sql-worker/src/execution apps/api/src/modules/sql packages/db
git commit -m "feat(sql): commit dml only after drift and recovery gates"
```

---

### Task 5: Implement conflict-safe reverse DML

**Files:**
- Create: `edutrack-ops/packages/contracts/src/reverseRecovery.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/reversePlanner.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/reversePlanner.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/reverseExecution.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/reverseExecution.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/recovery/reverseRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/recovery/reverseRoutes.test.ts`

**Interfaces:**
- Produces: `planReverseExecution`, reverse preview, conflict report, and audited reverse execution.

- [ ] **Step 1: Define reverse plan**

```ts
export type ReverseConflict = {
  schema: string;
  table: string;
  primaryKey: Record<string, unknown>;
  reason: 'ROW_CHANGED' | 'KEY_REUSED' | 'ROW_MISSING' | 'CONSTRAINT_CONFLICT' | 'SCHEMA_CHANGED';
};

export type ReversePlan = {
  originalExecutionId: string;
  recoveryExecutionId: string;
  eligibleChanges: JournalChange[];
  conflicts: ReverseConflict[];
  impactChecksum: string;
};
```

- [ ] **Step 2: Write reverse-planner tests**

Original INSERT deletes only exact after-hash; UPDATE restores before only from exact after-hash; DELETE reinserts only if absent. Cover newer edit, key reuse, schema column change, generated/default columns, FK ordering, cascades, two original executions touching same row, and expired artifact.

- [ ] **Step 3: Implement parameterized reverse operations**

Never concatenate row values into SQL. Build identifier-safe prepared operations from verified schema metadata and ordered journal changes. Reverse sequence is journal order descending with dependency checks. Conflicts stop automatic execution and recommend selective recovery.

- [ ] **Step 4: Reuse normal execution gates**

Reverse is a new DML execution: new reason/preview/checksum/MFA/confirmation/audit/journal/post-check. Link both executions and incident. A reverse may itself be reversed while its artifact is retained.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/sql-worker/src/recovery/reversePlanner.test.ts apps/sql-worker/src/recovery/reverseExecution.test.ts apps/api/src/modules/recovery/reverseRoutes.test.ts
git add packages/contracts/src/reverseRecovery.ts apps/sql-worker/src/recovery apps/api/src/modules/recovery
git commit -m "feat(recovery): reverse dml without overwriting later changes"
```

---

### Task 6: Implement transactional DDL, schema snapshots, and drift detection

**Files:**
- Create: `edutrack-ops/packages/contracts/src/schemaRecovery.ts`
- Create: `edutrack-ops/apps/sql-worker/src/schema/snapshotSchema.ts`
- Create: `edutrack-ops/apps/sql-worker/src/schema/snapshotSchema.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/ddlPreview.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/ddlPreview.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/ddlExecution.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/ddlExecution.test.ts`
- Create: `edutrack-ops/apps/processor/src/issues/schemaDrift.ts`
- Create: `edutrack-ops/apps/processor/src/issues/schemaDrift.test.ts`
- Create: `edutrack/scripts/export-schema-manifest.mjs`
- Create: `edutrack/scripts/export-schema-manifest.test.mjs`

**Interfaces:**
- Produces: canonical schema snapshots/diffs, DDL preview/execute, release schema manifest, and `SCHEMA_DRIFT` issues.

- [ ] **Step 1: Write stable snapshot tests**

Two logically identical schemas with different catalog OIDs/order yield identical canonical JSON/SHA-256. Changes to table/column/type/null/default/generated/constraint/index/trigger/partition/function signature produce explicit diff.

- [ ] **Step 2: Implement DDL preview**

Require `ops_ddl`, begin transaction, snapshot before, execute supported transactional DDL, snapshot after, compute diff/locks/warnings, then rollback. DROP/TRUNCATE always Critical/PITR_ONLY even when PostgreSQL supports transactional rollback.

- [ ] **Step 3: Implement DDL execution gates**

Require DDL flag, current DR gate, owner/maintainer policy, recent MFA, signed receipt, archived restore point, preview checksum, confirmation, and production identity. Execute in transaction, verify intended schema diff and `db/verify-schema.sql`/`db/verify-data.sql` equivalents, then commit or rollback.

- [ ] **Step 4: Publish/compare expected schema manifest**

Existing app build exports canonical migration list/checksums and expected schema checksum into its release manifest. After DDL, compare production; create/update High `SCHEMA_DRIFT` and link SQL execution. Resolve only when a source migration is deployed or production returns to manifest.

- [ ] **Step 5: Run and commit both repositories**

```bash
npx vitest run apps/sql-worker/src/schema apps/sql-worker/src/execution/ddlPreview.test.ts apps/sql-worker/src/execution/ddlExecution.test.ts apps/processor/src/issues/schemaDrift.test.ts
git add packages/contracts/src/schemaRecovery.ts apps/sql-worker/src apps/processor/src
git commit -m "feat(sql): preview ddl and detect schema drift"
```

In `edutrack`:

```bash
npx vitest run scripts/export-schema-manifest.test.mjs
git add scripts/export-schema-manifest.mjs scripts/export-schema-manifest.test.mjs
git commit -m "feat(db): publish expected schema manifest"
```

---

### Task 7: Implement non-transactional and sealed break-glass runners

**Files:**
- Create: `edutrack-ops/apps/sql-worker/src/execution/specialRunner.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/specialRunner.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/security/credentialBroker.ts`
- Create: `edutrack-ops/apps/sql-worker/src/security/credentialBroker.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/breakGlassRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/breakGlassRoutes.test.ts`
- Create: `edutrack-ops/deploy/vps/issue-breakglass-credential.sh`
- Create: `edutrack-ops/docs/runbooks/sql-break-glass.md`

**Interfaces:**
- Produces: isolated special execution and one-shot sealed privileged credential flow.

- [ ] **Step 1: Write classification/runner tests**

Cover `VACUUM`, `ANALYZE`, concurrent index, `REINDEX`, `CREATE/DROP DATABASE`, role/system/replication, `_ops`/trigger/session-replication changes, `COPY PROGRAM`, extension, and unparsed SQL. Ordinary DML/DDL credentials must never be used.

- [ ] **Step 2: Write credential-broker tests**

Require owner role, WebAuthn/TOTP within five minutes, active DR gate, off-host signed receipt readback, exact break-glass phrase, one command/execution binding, 10-minute expiry, one-time consumption, process memory zeroization best effort, and no credential in Ops DB/log/API.

- [ ] **Step 3: Implement special runner**

Run one classified statement/execution at a time with its required role, explicit timeout/cancel policy, pre/post database/schema/replication snapshot, restore point, and `PITR_ONLY`/`NO_AUTOMATIC_UNDO` status. Cluster/unparsed uses a one-shot child process environment populated from system credential, then terminates.

- [ ] **Step 4: Implement manual host issuance**

The script reads the sealed credential from system secret storage after validating an approved receipt ID and writes a mode-`0600`, short-lived credential file scoped to the worker service. It logs receipt/execution IDs only.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/sql-worker/src/execution/specialRunner.test.ts apps/sql-worker/src/security/credentialBroker.test.ts apps/api/src/modules/sql/breakGlassRoutes.test.ts
shellcheck deploy/vps/issue-breakglass-credential.sh
git add apps/sql-worker/src apps/api/src/modules/sql deploy/vps docs/runbooks/sql-break-glass.md
git commit -m "feat(sql): execute sealed nontransactional break glass commands"
```

---

### Task 8: Implement selective recovery and parameterized repair

**Files:**
- Create: `edutrack-ops/packages/contracts/src/selectiveRecovery.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/selectiveDiff.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/selectiveDiff.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/repairPlanner.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/repairPlanner.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/recovery/selectiveRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/recovery/selectiveRoutes.test.ts`

**Interfaces:**
- Produces: isolated-restore row/table comparison and an ordinary gated DML repair plan.

- [ ] **Step 1: Define selective request/result**

Require original execution/incident, target timestamp/LSN, allowlisted schemas/tables/primary keys, and recovery target identity. Result categorizes missing/added/changed/conflicting rows and schema incompatibilities.

- [ ] **Step 2: Write RED diff/planner tests**

Cover composite keys, table dropped/recreated, added/removed columns, current production changed after incident, FK dependencies, generated columns, partitioned tables, large values, and zero-diff. No test-generated repair contains a literal user value in SQL text.

- [ ] **Step 3: Implement isolated comparison**

Invoke the DR isolated restore orchestrator, pause at pre-execution target, connect read-only to restored/current DBs, stream selected rows ordered by primary key, hash/compare, and encrypt detailed diff artifacts.

- [ ] **Step 4: Generate parameterized repair operations**

Create typed operations (`insertRow`, `updateRow`, `deleteRow`) plus parameters and optimistic current hashes. Send them through the same DML preview/execution path; selective recovery never writes production directly.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/sql-worker/src/recovery/selectiveDiff.test.ts apps/sql-worker/src/recovery/repairPlanner.test.ts apps/api/src/modules/recovery/selectiveRoutes.test.ts
git add packages/contracts/src/selectiveRecovery.ts apps/sql-worker/src/recovery apps/api/src/modules/recovery
git commit -m "feat(recovery): repair selected rows from isolated pitr"
```

---

### Task 9: Implement PITR workflow, verification, and Recovery Center UI

**Files:**
- Create: `edutrack-ops/packages/db/src/schema/recoveryJobs.ts`
- Create: `edutrack-ops/packages/db/migrations/0006_recovery_jobs.sql`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/pitrJob.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/pitrJob.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/recovery/pitrRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/recovery/pitrRoutes.test.ts`
- Create: `edutrack-ops/apps/web/src/pages/RecoveryCenterPage.tsx`
- Create: `edutrack-ops/apps/web/src/features/recovery/RecoveryWizard.tsx`
- Create: `edutrack-ops/apps/web/src/features/recovery/VerificationPanel.tsx`
- Create: `edutrack-ops/apps/web/src/features/recovery/RecoveryTimeline.tsx`
- Test: matching `*.test.tsx` files.

**Interfaces:**
- Produces: persisted PITR state machine, verification evidence, and human cutover checkpoint.

- [ ] **Step 1: Define recovery state machine tests**

```text
REQUESTED -> RESTORING -> PAUSED_AT_TARGET -> VERIFYING -> READY_FOR_CUTOVER
                                                    \-> VERIFICATION_FAILED
READY_FOR_CUTOVER -> CUTOVER_AUTHORIZED -> COMPLETED
any pre-complete state -> CANCELLED/FAILED
```

Invalid/out-of-order/replayed transitions return conflict and audit. Only owner can authorize cutover; worker cannot self-transition to `CUTOVER_AUTHORIZED`.

- [ ] **Step 2: Implement PITR job**

Use the guarded DR orchestrator, target the recorded pre-execution LSN/time, verify recovery paused, run schema/data/app smoke and affected-table checks, persist signed evidence, and stop at `READY_FOR_CUTOVER`.

- [ ] **Step 3: Implement cutover authorization contract**

Require owner, MFA within five minutes, exact `CUTOVER RCV_<id>`, second readback of target/source identities, green verification, current backup/archive health, and separately executed infrastructure runbook. API records authorization; it does not silently rewrite app `DATABASE_URL`.

- [ ] **Step 4: Build Recovery Center**

Show recovery type/eligibility, source execution/incident, target time/LSN, progress, source/target identities, checks, artifacts, failure reason, runbook, and explicit confirmation. Destructive buttons require typed phrase and non-color warnings.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run packages/db/src apps/sql-worker/src/recovery/pitrJob.test.ts apps/api/src/modules/recovery/pitrRoutes.test.ts apps/web/src/features/recovery apps/web/src/pages/RecoveryCenterPage.test.tsx
git add packages/db apps/sql-worker/src/recovery apps/api/src/modules/recovery apps/web/src
git commit -m "feat(recovery): orchestrate verified pitr without auto cutover"
```

---

### Task 10: Build DML/DDL UI and prove destructive recovery before rollout

**Files:**
- Modify: `edutrack-ops/apps/web/src/pages/SqlWorkspacePage.tsx`
- Modify: `edutrack-ops/apps/web/src/pages/SqlHistoryPage.tsx`
- Modify: `edutrack-ops/apps/web/src/features/database/ClassificationPanel.tsx`
- Create: `edutrack-ops/apps/web/src/features/database/ImpactPreview.tsx`
- Create: `edutrack-ops/apps/web/src/features/database/ConfirmationDialog.tsx`
- Create: `edutrack-ops/apps/web/src/features/database/SchemaDiff.tsx`
- Create: `edutrack-ops/apps/web/src/features/database/ReverseExecutionDialog.tsx`
- Test: matching `*.test.tsx` files.
- Create: `edutrack-ops/e2e/sql-mutation-recovery.spec.ts`
- Create: `edutrack-ops/e2e/sql-ddl-pitr.spec.ts`
- Create: `edutrack-ops/docs/runbooks/data-correction.md`
- Create: `edutrack-ops/docs/runbooks/ddl-and-pitr.md`

**Interfaces:**
- Produces: complete preview/confirm/execute/verify/reverse/PITR UX and drill evidence.

- [ ] **Step 1: Write UI safety tests**

Require reason/ticket, issue/incident link, before/after table diff, counts/triggers/risk/recoverability, production identity, preview expiry/drift refresh, MFA freshness, exact phrase, no-WHERE warning, external-effect warning, post-check result, and recovery eligibility. UI cannot send a skip flag.

- [ ] **Step 2: Implement mutation/DDL flow**

Read classification -> request preview -> render impact/schema diff -> challenge MFA when needed -> exact confirmation -> execute -> show commit/rollback/verification/journal/restore point/audit link. On `PREVIEW_DRIFT`, discard confirmation and require a new preview.

- [ ] **Step 3: Implement reverse/selective/PITR handoff**

History detail shows `REVERSIBLE`, `SELECTIVE_REQUIRED`, `PITR_ONLY`, or `NO_AUTOMATIC_UNDO`. Reverse conflicts cannot be overridden; they link to selective recovery.

- [ ] **Step 4: Run disposable destructive E2E**

Test direct/cascaded insert/update/delete, concurrent drift, reverse success/conflict, trigger/outbox warning, DROP/TRUNCATE, transactional/non-transactional DDL, schema drift, selective repair, failed verification, PITR ready state, and cutover authorization without automatic application switch.

- [ ] **Step 5: Run full verification**

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e -- sql-mutation-recovery sql-ddl-pitr
```

- [ ] **Step 6: Rehearse on restored production-shaped data**

Execute single-row correction, mass delete, truncate, drop table, incompatible alter, non-transactional index, and primary-loss drills. Require complete audit/journal/restore evidence and measured DR objectives.

- [ ] **Step 7: Commit and activate capabilities separately**

```bash
git add apps/web e2e docs/runbooks
git commit -m "feat(web): operate and recover production sql changes"
```

Activation order with separate approvals and observation:

1. `OPS_SQL_MUTATION_ENABLED=true` for one maintainer; immediate harmless reverse drill; observe 14 days.
2. `OPS_SQL_DDL_ENABLED=true`; transactional DDL only; observe and reconcile schema drift.
3. `OPS_SQL_BREAK_GLASS_ENABLED=true` for owners only after sealed-credential/off-host-receipt review.

**Exit gate:** no unjournaled registered-table DML can commit, drift is fail-closed, reverse refuses newer changes, destructive drills recover within objectives, PITR cannot auto-cutover, and each capability completed its activation gate.
