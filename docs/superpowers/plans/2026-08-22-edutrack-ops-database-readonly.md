# EduTrack Ops Read-Only Database Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a production PostgreSQL schema browser and raw read-only SQL workspace whose safety remains enforced if the SQL classifier or UI is bypassed.

**Architecture:** The public Ops API orchestrates a private SQL worker over an authenticated Unix-domain protocol. The worker parses PostgreSQL statements for classification/UX, but connects with a database role and transaction mode that cannot mutate production. Results use a bounded server-side cursor, encrypted artifacts, cancellation through a separate control connection, append-only audit, and issue/incident linking.

**Tech Stack:** TypeScript, Node.js 22, Express 5, PostgreSQL 16, `pg`, `pg-cursor`, `pgsql-ast-parser`, Drizzle, React 19, CodeMirror 6, TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-22-edutrack-ops-plane-design.md`

## Global Constraints

- Browser and Ops API never receive production database credentials.
- Committed and initial production default is `OPS_SQL_READ_ENABLED=false`.
- `READ` includes `SELECT`, safe `SHOW`, and `EXPLAIN` without mutation-producing `ANALYZE`; transaction/role enforcement remains authoritative.
- Unparsed or mixed read/write batches are rejected during this phase; unparsed break-glass belongs to the mutation/recovery plan.
- Every query requires an authenticated `ops_maintainer`/`ops_owner`, SQL elevation, reason, actor/session, and audit record.
- Default result cap is 500 rows and 10 MiB; timeout is 30 seconds; lock timeout is 3 seconds.
- Viewer can see redacted execution metadata but cannot execute SQL or retrieve result artifacts.
- The read-only database role has no ownership, create, temporary-table, function-creation, role, replication, or write privileges.

---

### Task 1: Define SQL contracts and PostgreSQL statement classification

**Files:**
- Create: `edutrack-ops/packages/contracts/src/sql.ts`
- Create: `edutrack-ops/packages/contracts/src/database.ts`
- Modify: `edutrack-ops/packages/contracts/src/index.ts`
- Create: `edutrack-ops/apps/sql-worker/src/classifier/classifySql.ts`
- Create: `edutrack-ops/apps/sql-worker/src/classifier/classifySql.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/classifier/fixtures.ts`

**Interfaces:**
- Produces: `SqlClassification`, `SqlStatementInfo`, `classifySql(sql)`, and stable risk/recoverability labels.

- [ ] **Step 1: Define exact contracts**

```ts
export type SqlClass =
  | 'READ'
  | 'DML'
  | 'TRANSACTIONAL_DDL'
  | 'NON_TRANSACTIONAL'
  | 'CLUSTER_LEVEL'
  | 'UNPARSED_BREAK_GLASS';

export type Recoverability = 'NOT_REQUIRED' | 'REVERSIBLE' | 'PITR_ONLY' | 'NO_AUTOMATIC_UNDO';

export type SqlStatementInfo = {
  index: number;
  class: SqlClass;
  command: string;
  normalizedFingerprint: string;
  tables: string[];
  warnings: string[];
  recoverability: Recoverability;
};

export type SqlClassification = {
  statements: SqlStatementInfo[];
  batchClass: SqlClass;
  executableInReadOnly: boolean;
};

export type DatabaseSchemaSnapshot = {
  databaseIdentity: string;
  generatedAt: string;
  schemas: Array<{
    name: string;
    relations: Array<{
      name: string;
      kind: 'table' | 'partitioned_table' | 'view' | 'materialized_view';
      columns: Array<{ name: string; postgresType: string; nullable: boolean; defaultExpression: string | null; generated: boolean }>;
      primaryKey: string[];
      foreignKeys: Array<{ columns: string[]; targetSchema: string; targetTable: string; targetColumns: string[] }>;
      constraints: string[];
      indexes: string[];
      triggers: string[];
      comment: string | null;
    }>;
  }>;
  checksum: string;
};
```

- [ ] **Step 2: Write a RED classification corpus**

Cover whitespace/comments, multiple statements, CTE `SELECT`, writable CTE, `SELECT ... FOR UPDATE`, `EXPLAIN ANALYZE INSERT`, `COPY`, `CALL`, `DO`, transaction control, `SET ROLE`, `SET session_replication_role`, dollar quotes, Unicode identifiers, DML/DDL, `VACUUM`, concurrent index, database/role/system commands, and parser-unsupported syntax.

- [ ] **Step 3: Implement fail-closed classification**

Use `pgsql-ast-parser` to classify known syntax. A parser error returns `UNPARSED_BREAK_GLASS`, never `READ`. Normalize fingerprints by AST/parameterized literal representation, not unsafe regular-expression deletion.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run apps/sql-worker/src/classifier
git add packages/contracts/src apps/sql-worker/src/classifier
git commit -m "feat(sql): classify postgres statements fail closed"
```

---

### Task 2: Provision least-privilege read and cancel database roles

**Files:**
- Create: `edutrack-ops/deploy/postgres/001_ops_readonly_roles.sql`
- Create: `edutrack-ops/deploy/postgres/apply-role-grants.sh`
- Create: `edutrack-ops/deploy/postgres/verify-readonly-role.ts`
- Create: `edutrack-ops/deploy/postgres/verify-readonly-role.test.ts`
- Create: `edutrack-ops/docs/runbooks/sql-role-rotation.md`

**Interfaces:**
- Produces: NOLOGIN group roles `ops_readonly`, `ops_cancel`, separate login credentials injected at deployment, and a bypass-proof verification report.

- [ ] **Step 1: Write role verification tests**

As the read login, assert simple/schema/catalog reads pass and all of these fail:

```sql
INSERT INTO <fixture> ...;
UPDATE <fixture> ...;
DELETE FROM <fixture> ...;
TRUNCATE <fixture>;
CREATE TABLE ...;
CREATE TEMP TABLE ...;
ALTER TABLE ...;
DROP TABLE ...;
CREATE FUNCTION ...;
SET ROLE ...;
```

Also assert `current_setting('default_transaction_read_only')='on'`, no membership in owner/superuser roles, and no `BYPASSRLS`/replication.

- [ ] **Step 2: Implement role SQL without credentials**

Create NOLOGIN group roles, grant only database CONNECT, schema USAGE, table/view SELECT, sequence SELECT where needed, and catalog visibility. Set statement/lock/idle transaction timeouts at role level. Grant `pg_signal_backend` only to the separate cancel login; grant it no table access.

Grant business schemas explicitly; never use a database-wide wildcard that includes `_ops`. Revoke `_ops` schema/table/function access from both read and cancel roles.

- [ ] **Step 3: Implement credential-safe apply/rotation script**

Read generated passwords from mode-`0600` files/system credentials, pass them through `psql` variables without shell/log echo, create/rotate login roles, verify, and revoke old login after active sessions drain.

- [ ] **Step 4: Run on disposable PostgreSQL and commit**

```bash
npx vitest run deploy/postgres/verify-readonly-role.test.ts
shellcheck deploy/postgres/apply-role-grants.sh
git add deploy/postgres docs/runbooks/sql-role-rotation.md
git commit -m "feat(sql): provision enforced read only database roles"
```

- [ ] **Step 5: Apply to production under operational approval**

Record role/grant diff, run `verify-readonly-role.ts` against production fixtures in a rollback transaction, and store only status/role/grant hashes in audit evidence.

---

### Task 3: Build the private API-to-worker protocol

**Files:**
- Create: `edutrack-ops/packages/contracts/src/workerProtocol.ts`
- Create: `edutrack-ops/apps/sql-worker/src/protocol/framing.ts`
- Create: `edutrack-ops/apps/sql-worker/src/protocol/framing.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/protocol/authenticateCommand.ts`
- Create: `edutrack-ops/apps/sql-worker/src/protocol/authenticateCommand.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/server.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/workerClient.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/workerClient.test.ts`

**Interfaces:**
- Produces: length-delimited `WorkerCommand/WorkerResponse`, Unix socket server/client, HMAC request authentication, nonce replay protection, and per-command timeout.

- [ ] **Step 1: Define protocol**

```ts
export type WorkerCommand = {
  protocolVersion: 1;
  commandId: string;
  issuedAt: string;
  nonce: string;
  actor: { userId: string; sessionId: string; role: 'ops_maintainer' | 'ops_owner' };
  kind: 'schema.read' | 'sql.classify' | 'sql.previewRead' | 'sql.cancel';
  payload: unknown;
  signature: string;
};

export type WorkerResponse =
  | { protocolVersion: 1; commandId: string; ok: true; result: unknown }
  | { protocolVersion: 1; commandId: string; ok: false; error: { code: string; safeMessage: string; eventId?: string } };
```

- [ ] **Step 2: Write RED protocol tests**

Cover partial/multiple frames, 1 MiB command limit, invalid JSON/schema/version, expired issue time, nonce replay, signature tamper, wrong role, slowloris timeout, socket permissions, and sanitized error responses.

- [ ] **Step 3: Implement private transport**

Bind to `/run/edutrack-ops/sql-worker.sock`, mode `0660`, group `edutrack-ops`. Use HMAC-SHA256 with a system credential shared only by API/worker. Persist nonce hashes with short TTL in Ops DB. Never bind a TCP public port.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run apps/sql-worker/src/protocol apps/api/src/modules/sql/workerClient.test.ts
git add packages/contracts/src/workerProtocol.ts apps/sql-worker/src apps/api/src/modules/sql/workerClient.ts apps/api/src/modules/sql/workerClient.test.ts
git commit -m "feat(sql): authenticate private sql worker commands"
```

---

### Task 4: Implement schema/catalog introspection

**Files:**
- Create: `edutrack-ops/apps/sql-worker/src/database/readPool.ts`
- Create: `edutrack-ops/apps/sql-worker/src/database/readPool.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/schema/introspectSchema.ts`
- Create: `edutrack-ops/apps/sql-worker/src/schema/introspectSchema.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/database/schemaRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/database/schemaRoutes.test.ts`

**Interfaces:**
- Produces: `readProductionSchema(): DatabaseSchemaSnapshot` and `GET /api/v1/database/schema`.

- [ ] **Step 1: Write schema snapshot tests**

Create fixture schemas/tables/views/materialized views/enums/generated columns/PK/FK/unique/check/index/partition/trigger/comment/RLS, then assert stable sorted DTOs and no function body/credential leakage.

- [ ] **Step 2: Implement the read pool**

Use only the read login, TLS verify-full, application name `edutrack-ops-read`, maximum two connections, role timeouts, and connection startup assertion that current user/DB/host match allowlisted identifiers and transaction is read-only.

- [ ] **Step 3: Implement catalog queries**

Query `pg_catalog`/`information_schema` with parameterized schema filters; exclude system/temp schemas and `_ops` internals by default. Cache for 60 seconds, keyed by database identity/schema checksum.

- [ ] **Step 4: Implement API authorization/audit**

Viewer may use Schema Browser; response contains structural metadata only. Record access audit at a bounded rate rather than per navigation repaint.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/sql-worker/src/database apps/sql-worker/src/schema apps/api/src/modules/database
git add apps/sql-worker/src/database apps/sql-worker/src/schema apps/api/src/modules/database
git commit -m "feat(database): browse production postgres schema safely"
```

---

### Task 5: Implement bounded read execution, preview, and explain

**Files:**
- Create: `edutrack-ops/apps/sql-worker/src/execution/readExecution.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/readExecution.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/resultEncoding.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/resultEncoding.test.ts`
- Create: `edutrack-ops/packages/db/src/schema/sqlExecutions.ts`
- Create: `edutrack-ops/packages/db/migrations/0003_sql_readonly.sql`
- Create: `edutrack-ops/apps/api/src/modules/sql/sqlRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/sqlRoutes.test.ts`

**Interfaces:**
- Produces: `previewReadExecution(input): ReadPreview`, classify/preview routes, bounded rows/columns/types, and execution audit metadata.

- [ ] **Step 1: Define read preview**

```ts
export type ReadPreview = {
  previewId: `PRV_${string}`;
  classification: SqlClassification;
  columns: Array<{ name: string; postgresType: string }>;
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  encodedBytes: number;
  durationMs: number;
  backendPid: number;
  expiresAt: string;
};
```

- [ ] **Step 2: Write RED execution tests**

Cover 0/1/500/501 rows, 10 MiB boundary, numeric/date/json/bytea/null encoding, huge cell truncation, 30-second timeout, 3-second lock timeout, multi-statement read batch, `SELECT FOR UPDATE`, transaction cleanup, connection reuse, and attempted mutations rejected by both classifier and database.

- [ ] **Step 3: Implement bounded cursor execution**

Begin `READ ONLY`, set local timeouts/application context, declare `pg-cursor`, fetch at most 501 rows while tracking encoded bytes, close cursor, roll back read transaction, and return safe column/row DTOs. Never concatenate a `LIMIT` onto user SQL.

- [ ] **Step 4: Persist metadata and append audit**

Store encrypted original SQL, redacted display SQL, fingerprint, reason, actor, duration, row count, truncation, status, request/issue/incident IDs. `previewId` expires in five minutes. Read execution still uses audit but requires no recovery point.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/sql-worker/src/execution packages/db/src apps/api/src/modules/sql
git add apps/sql-worker/src/execution packages/db apps/api/src/modules/sql
git commit -m "feat(sql): execute bounded read only previews"
```

---

### Task 6: Add cancellation, encrypted result artifacts, and execution history

**Files:**
- Create: `edutrack-ops/apps/sql-worker/src/execution/cancelExecution.ts`
- Create: `edutrack-ops/apps/sql-worker/src/execution/cancelExecution.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/resultArtifacts.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/resultArtifacts.test.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/historyRoutes.ts`
- Create: `edutrack-ops/apps/api/src/modules/sql/historyRoutes.test.ts`
- Create: `edutrack-ops/packages/security/src/encryption/envelope.ts`
- Create: `edutrack-ops/packages/security/src/encryption/envelope.test.ts`

**Interfaces:**
- Produces: cancel route, encrypted artifact store, role-aware history/detail APIs, and cryptographic erasure metadata.

- [ ] **Step 1: Write cancel tests**

Only the actor or owner may cancel an active execution; match execution ID to recorded backend PID/start time/database identity; call `pg_cancel_backend`; terminate the connection only after a grace timeout; never cancel an unrelated reused PID.

- [ ] **Step 2: Write encryption/artifact tests**

Use per-artifact random data key, AES-256-GCM, wrapped key/version, SHA-256 digest, private object key, 10 MiB maximum, TTL, and authorized readback. Tamper/wrong key/wrong actor fails.

- [ ] **Step 3: Implement history privacy**

Viewer sees actor/time/reason/fingerprint/status/duration/row count and redacted SQL. Executing maintainer and owner may retrieve encrypted SQL/result with recent session and explicit audit. Search never indexes plaintext encrypted fields.

- [ ] **Step 4: Run and commit**

```bash
npx vitest run apps/sql-worker/src/execution/cancelExecution.test.ts apps/api/src/modules/sql packages/security/src/encryption
git add apps/sql-worker/src/execution apps/api/src/modules/sql packages/security/src/encryption
git commit -m "feat(sql): cancel queries and protect result history"
```

---

### Task 7: Build Schema Browser, SQL Workspace, and History UI

**Files:**
- Create: `edutrack-ops/apps/web/src/pages/SchemaBrowserPage.tsx`
- Create: `edutrack-ops/apps/web/src/pages/SqlWorkspacePage.tsx`
- Create: `edutrack-ops/apps/web/src/pages/SqlHistoryPage.tsx`
- Create: `edutrack-ops/apps/web/src/features/database/SchemaTree.tsx`
- Create: `edutrack-ops/apps/web/src/features/database/SqlEditor.tsx`
- Create: `edutrack-ops/apps/web/src/features/database/ClassificationPanel.tsx`
- Create: `edutrack-ops/apps/web/src/features/database/ResultGrid.tsx`
- Create: `edutrack-ops/apps/web/src/features/database/ExecutionDrawer.tsx`
- Create: `edutrack-ops/apps/web/src/features/database/sqlApi.ts`
- Test: matching `*.test.tsx` files.

**Interfaces:**
- Produces: read-only production SQL UX with schema autocomplete, preview/results, cancel, history, and issue handoff.

- [ ] **Step 1: Write UI behavior tests**

Require permanent `PRODUCTION` badge, elevation countdown, reason before run, disabled run for viewer/expired elevation/non-READ classification, 500-row/10-MiB truncation notice, keyboard run shortcut with confirmation, cancel state, column/value safe rendering, and issue/incident link.

- [ ] **Step 2: Implement Schema Browser**

Lazy-expand schemas/tables; show columns/types/null/default/generated, PK/FK/constraints/indexes/triggers/partitions/comments. Selecting a table inserts an allowlisted quoted starter query; never interpolate an unquoted identifier.

- [ ] **Step 3: Implement editor and results**

Use CodeMirror SQL mode, server classification, tabbed workspaces stored only in session memory, explicit reason, result virtualization, copy/export audit, and accessible table navigation. Do not persist raw SQL in localStorage.

- [ ] **Step 4: Implement history/detail**

Filter by actor/status/time/fingerprint/issue; show redacted SQL to viewer; require explicit authorized reveal for encrypted content; provide “open as new workspace” without auto-execute.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run apps/web/src/features/database apps/web/src/pages/SchemaBrowserPage.test.tsx apps/web/src/pages/SqlWorkspacePage.test.tsx apps/web/src/pages/SqlHistoryPage.test.tsx
npm run build --workspace apps/web
git add apps/web/src
git commit -m "feat(web): add read only production sql console"
```

---

### Task 8: Verify defense in depth and stage read-only rollout

**Files:**
- Create: `edutrack-ops/e2e/sql-readonly.spec.ts`
- Create: `edutrack-ops/apps/sql-worker/src/security/classifierBypass.test.ts`
- Create: `edutrack-ops/docs/runbooks/read-only-sql.md`
- Modify: `edutrack-ops/deploy/vps/validate-environment.mjs`
- Modify: `edutrack-ops/deploy/vps/ecosystem.config.cjs`

**Interfaces:**
- Produces: bypass/cancel/timeout/privacy evidence and a controlled feature-flag rollout.

- [ ] **Step 1: Write classifier-bypass integration test**

Call the worker read executor directly with `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, `ALTER`, `DROP`, writable CTE, and `SELECT FOR UPDATE`. Require PostgreSQL rejection and unchanged fixture checksums.

- [ ] **Step 2: Write Playwright flow**

Login + MFA -> elevate -> browse schema -> run bounded SELECT -> cancel `pg_sleep` -> open linked history -> viewer sees redacted metadata but cannot execute/reveal result.

- [ ] **Step 3: Run full verification**

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e -- sql-readonly
```

- [ ] **Step 4: Deploy disabled and test private connectivity**

Deploy with `OPS_SQL_READ_ENABLED=false`, verify worker socket/TLS/database identity, and run role verifier. Then approve one named maintainer and change only the production flag to true.

- [ ] **Step 5: Observe and commit**

Observe seven days for timeouts, cancellation, audit completeness, artifact access, database load, and unexpected function behavior. Commit runbook/tests before wider enablement.

```bash
git add e2e apps/sql-worker/src/security docs/runbooks/read-only-sql.md deploy/vps
git commit -m "test(sql): prove and stage read only console"
```

**Exit gate:** database-enforced bypass tests pass, browser sees no credential, every query is attributed/audited/bounded/cancellable, and read-only access has completed the one-maintainer observation window.
