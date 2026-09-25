# EduTrack Ops Database Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only, audited Database Explorer for the EduTrack Production and Ops PostgreSQL databases, with bounded table browsing, relationship diagrams, and MFA-gated PII reveal.

**Architecture:** Extend the existing private SQL worker into a closed two-target registry. The Ops API performs session/role/CSRF/step-up authorization and append-only audit, while the worker resolves catalog identifiers, constructs parameterized bounded reads, masks data, and connects through target-specific database-enforced read-only roles. The React app consumes structured schema/row contracts only; it never receives credentials or a raw SQL interface.

**Tech Stack:** TypeScript 5.8, Node.js 22, Express 5, PostgreSQL 16, `pg`, Zod, React 19, `@xyflow/react` 12.12.0, `@dagrejs/dagre` 3.1.1, Vitest 4, Testing Library, Playwright 1.59.

**Spec:** `docs/superpowers/specs/2026-09-25-database-explorer-design.md`

## Global Constraints

- The only target IDs are `edutrack_production` and `ops`; no browser/API input can select a connection string or arbitrary database.
- `ops_viewer` can inspect schema and relationships but cannot request table rows.
- `ops_maintainer` and `ops_owner` can browse bounded rows; PII is masked unless a valid `database_pii` grant is active.
- Password, OTP, session, credential, encryption, and provider-token values are never selected or returned.
- Every target uses a separate TLS `verify-full` connection, expected database/role identity, `default_transaction_read_only=on`, and a maximum of two connections.
- One row request permits at most five filters, 200 characters per filter value, page sizes 25/50/100, a 15-second statement timeout, a 2-second lock timeout, a 2 MiB response, and 64 KiB per scalar cell.
- Raw SQL, cross-target joins, export, and every mutation are out of scope.
- Row and reveal responses use `Cache-Control: no-store`; browser code never persists row values, cursors, or reveal state in local storage.
- Audit failure fails row access and PII reveal closed.
- The feature and each target remain disabled by default until role, policy, security, and rollout gates pass.

## Review Focus

- PostgreSQL identifiers containing quotes, spaces, Unicode, or reserved words must resolve only from the snapshot and be safely quoted; Task 5 pins this with query-builder tests.
- A schema checksum change between metadata load and row access must return `DATABASE_SCHEMA_STALE` before selecting data; Tasks 2, 4, and 6 pin policy and API behavior.
- Nullable or duplicate sort values must not skip or repeat stable-key rows across cursors; Task 5 pins both ascending and descending cursor cases.
- Oversized JSON, arrays, and `bytea` must stay within cell/response limits without returning partial secrets or invalid JSON; Task 5 pins encoding boundaries.
- An expired, revoked, wrong-target, wrong-IP, or wrong-session reveal grant must never produce revealed PII; Task 6 pins every binding dimension and fail-closed audit behavior.

---

### Task 1: Define explorer contracts, permissions, and canonical Ops roles

**Files:**
- Create: `packages/contracts/src/databaseExplorer.ts`
- Create: `packages/contracts/src/databaseExplorer.test.ts`
- Modify: `packages/contracts/src/databaseSchema.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/workerProtocol.ts`
- Modify: `packages/security/src/sessions.ts`
- Modify: `packages/security/src/sessions.test.ts`
- Modify: `apps/web/src/web/api.ts`
- Modify: `apps/web/src/web/pages/UsersPage.tsx`
- Modify: `apps/web/src/web/App.test.tsx`
- Modify: `apps/web/src/web/pages/VariablesPage.test.tsx`

**Interfaces:**
- Consumes: existing `OpsRole`, `DatabaseSchemaSnapshot`, `WorkerCommand`, and `WorkerResponse`.
- Produces: `DatabaseTargetId`, target/schema/row/relation request and response DTOs, `database:schema:read`, `database:data:read`, `database:pii:reveal`, and worker kinds `database.schema`, `database.rows`, `database.relatedRows`.

- [ ] **Step 1: Write failing contract and permission tests**

```ts
it('keeps targets closed and row page sizes bounded', () => {
  expect(DATABASE_TARGET_IDS).toEqual(['edutrack_production', 'ops']);
  expect(isDatabasePageSize(25)).toBe(true);
  expect(isDatabasePageSize(100)).toBe(true);
  expect(isDatabasePageSize(101)).toBe(false);
});

it('allows viewers to read schema but not data or reveal PII', () => {
  expect(() => assertPermission('ops_viewer', 'database:schema:read')).not.toThrow();
  expect(() => assertPermission('ops_viewer', 'database:data:read')).toThrow(/denied/i);
  expect(() => assertPermission('ops_viewer', 'database:pii:reveal')).toThrow(/denied/i);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run packages/contracts/src/databaseExplorer.test.ts packages/security/src/sessions.test.ts apps/web/src/web/App.test.tsx`

Expected: FAIL because explorer contracts/permissions do not exist and the web still declares `ops_readonly`.

- [ ] **Step 3: Add the exact public contract**

```ts
export const DATABASE_TARGET_IDS = ['edutrack_production', 'ops'] as const;
export type DatabaseTargetId = (typeof DATABASE_TARGET_IDS)[number];
export const DATABASE_PAGE_SIZES = [25, 50, 100] as const;
export type DatabasePageSize = (typeof DATABASE_PAGE_SIZES)[number];
export type DatabaseColumnClassification = 'public' | 'internal' | 'pii' | 'blocked';
export type DatabaseFilterOperator =
  | 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_null' | 'is_not_null';
export type DatabaseCell =
  | { state: 'value'; value: null | boolean | number | string | unknown[] | Record<string, unknown> }
  | { state: 'masked'; display: string }
  | { state: 'blocked' }
  | { state: 'truncated'; display: string; originalBytes: number };
export type DatabaseRowsRequest = {
  targetId: DatabaseTargetId;
  schema: string;
  relation: string;
  pageSize: DatabasePageSize;
  cursor?: string;
  sort?: { column: string; direction: 'asc' | 'desc' };
  filters: Array<{ column: string; operator: DatabaseFilterOperator; value?: string }>;
  piiMode: 'masked' | 'revealed';
};
export type DatabaseRowsResponse = {
  targetId: DatabaseTargetId;
  schemaChecksum: string;
  policyVersion: string;
  schema: string;
  relation: string;
  columns: DatabaseExplorerColumn[];
  rows: Array<{ rowRef: string | null; cells: Record<string, DatabaseCell> }>;
  nextCursor: string | null;
  truncated: boolean;
  encodedBytes: number;
  consistency: 'stable' | 'best_effort';
  piiMode: 'masked' | 'revealed';
};
```

Also define `DatabaseTargetSummary`, `DatabaseExplorerSchemaSnapshot`, `DatabaseExplorerColumn`, `DatabaseRelatedRowsRequest`, `DatabaseRelationEdge`, and `isDatabaseTargetId`/`isDatabasePageSize`. Extend schema columns with classification and allowed filter operators without removing the existing fields.

- [ ] **Step 4: Add permissions and normalize the stale web role name**

Add the three database permissions to `OpsPermission`. Give `database:schema:read` to every role and give `database:data:read` plus `database:pii:reveal` only to maintainer/owner. Replace every `ops_readonly` web type/value/fixture with the canonical backend value `ops_viewer`; keep the Vietnamese label `Read-only`.

- [ ] **Step 5: Run contract, security, and affected web tests**

Run: `npx vitest run packages/contracts/src/databaseExplorer.test.ts packages/security/src/sessions.test.ts apps/web/src/web/App.test.tsx apps/web/src/web/pages/UsersPage.test.tsx apps/web/src/web/pages/VariablesPage.test.tsx`

Expected: PASS, including login/session fixtures that return `ops_viewer`.

- [ ] **Step 6: Commit the contract boundary**

```bash
git add packages/contracts/src packages/security/src/sessions.ts packages/security/src/sessions.test.ts apps/web/src/web
git commit -m "feat(database): define explorer contracts and permissions"
```

### Task 2: Implement fail-closed column policy and schema approval

**Files:**
- Create: `packages/security/src/database/columnPolicy.ts`
- Create: `packages/security/src/database/columnPolicyManifest.ts`
- Create: `packages/security/src/database/columnPolicy.test.ts`
- Modify: `packages/security/src/index.ts`
- Create: `apps/sql-worker/src/explorer/policyApproval.ts`
- Create: `apps/sql-worker/src/explorer/policyApproval.test.ts`
- Create: `scripts/database-explorer/render-policy-report.mjs`
- Create: `scripts/database-explorer/render-policy-report.test.ts`

**Interfaces:**
- Consumes: `DatabaseTargetId`, catalog schema/relation/column names, and a target schema checksum.
- Produces: `classifyColumn(input): DatabaseColumnClassification`, `assertPolicyApproved(input): void`, `DATABASE_POLICY_VERSION`, and a redacted policy review report.

- [ ] **Step 1: Write failing precedence, drift, and secret-corpus tests**

```ts
it.each([
  ['edutrack_production', 'public', 'zalo_config', 'access_token'],
  ['edutrack_production', 'public', 'staff_password_credentials', 'password_hash'],
  ['edutrack_production', 'public', 'auth_otp_challenges', 'otp_hash'],
  ['edutrack_production', 'public', 'auth_sessions', 'token_hash'],
  ['ops', 'public', 'ops_mfa_factors', 'encrypted_secret'],
  ['ops', 'public', 'ops_sessions', 'csrf_secret_hash'],
  ['ops', 'public', 'sql_executions', 'original_sql_ciphertext']
] as const)('always blocks %s:%s.%s.%s', (targetId, schema, relation, column) => {
  expect(classifyColumn({ targetId, schema, relation, column }))
    .toBe('blocked');
});

it('blocks row access when the live schema checksum is not approved', () => {
  expect(() => assertPolicyApproved({
    targetId: 'ops', liveChecksum: 'b'.repeat(64),
    approval: { version: '2026-09-25', targets: { ops: 'a'.repeat(64) } }
  })).toThrowError('DATABASE_SCHEMA_STALE');
});
```

Include PII cases for `email`, `phone`, `display_name`, `full_name`, `address`, free-form `content`/`answer`/`comment`, and `raw_payload`. Include precedence proving an exact `public` override cannot override a blocked name.

- [ ] **Step 2: Run policy tests and verify RED**

Run: `npx vitest run packages/security/src/database/columnPolicy.test.ts apps/sql-worker/src/explorer/policyApproval.test.ts scripts/database-explorer/render-policy-report.test.ts`

Expected: FAIL because the policy modules and report script do not exist.

- [ ] **Step 3: Implement ordered classification rules**

Use this precedence: exact blocked override -> blocked name rule -> exact PII override -> PII name rule -> exact public override -> `internal`. The blocked matcher must include full-token forms of `password`, `passwd`, `salt`, `otp`, `token`, `secret`, `credential`, `private_key`, `encryption_key`, `ciphertext`, and `csrf`. Exact blocked overrides must cover the seven corpus examples above plus EduTrack `zalo_config.refresh_token`, `parent_accounts.password_hash/password_salt`, `student_auth_credentials.*password*`, and Ops MFA/session/login/enrollment secret fields.

Masking rules return only safe display strings such as `t***@example.com`, `******1234`, or `••••••`; they never include more than four trailing phone characters or the local part beyond its first character.

- [ ] **Step 4: Implement checksum approval and the safe review report**

`assertPolicyApproved` accepts only this parsed shape:

```ts
type DatabasePolicyApproval = {
  version: string;
  targets: Partial<Record<DatabaseTargetId, string>>;
};
```

The report script reads a structural schema snapshot from stdin and prints only target/schema/relation/column/classification plus checksum; it must reject snapshots containing row values. Test that the report never echoes sample email, phone, token, or JSON cell values injected into the input.

- [ ] **Step 5: Run policy tests**

Run: `npx vitest run packages/security/src/database apps/sql-worker/src/explorer/policyApproval.test.ts scripts/database-explorer/render-policy-report.test.ts`

Expected: PASS with unmatched approved columns classified `internal` and unapproved checksums rejected before row SQL is built.

- [ ] **Step 6: Commit the policy boundary**

```bash
git add packages/security/src/database packages/security/src/index.ts apps/sql-worker/src/explorer scripts/database-explorer
git commit -m "feat(database): enforce explorer column policy"
```

### Task 3: Add isolated multi-target worker configuration and registry

**Files:**
- Create: `apps/sql-worker/src/database/targetRegistry.ts`
- Create: `apps/sql-worker/src/database/targetRegistry.test.ts`
- Modify: `apps/sql-worker/src/runtime/runtimeConfig.ts`
- Modify: `apps/sql-worker/src/runtime/runtimeConfig.test.ts`
- Modify: `apps/sql-worker/src/runtime/main.ts`
- Modify: `apps/sql-worker/src/runtime/main.test.ts`
- Modify: `apps/sql-worker/src/runtime/commandHandler.ts`
- Modify: `apps/sql-worker/src/runtime/commandHandler.test.ts`
- Modify: `packages/contracts/src/workerProtocol.ts`
- Modify: `deploy/ops/env/sql-worker.env.example`
- Modify: `deploy/ops/env/sql-worker.env.example.test.ts`
- Modify: `deploy/ops/systemd/edutrack-ops-sql-worker.service`
- Modify: `deploy/ops/systemd/systemd-assets.test.ts`

**Interfaces:**
- Consumes: target IDs, policy approval, the existing `SqlWorkerClient` protocol, `assertTlsProtectedPostgresUrl`, and `assertProductionReadIdentity`.
- Produces: `DatabaseTargetRegistry.get(targetId)`, target status summaries, and worker handlers for `database.schema`, `database.rows`, and `database.relatedRows`.

- [ ] **Step 1: Write failing runtime and target-isolation tests**

```ts
it('never falls back from an unavailable requested target', async () => {
  const registry = createTargetRegistry([
    { id: 'edutrack_production', status: 'unavailable', code: 'DATABASE_TARGET_UNAVAILABLE' },
    healthyOpsTarget
  ]);
  expect(() => registry.get('edutrack_production')).toThrow('DATABASE_TARGET_UNAVAILABLE');
  expect(registry.get('ops').id).toBe('ops');
});

it('rejects raw URLs and arbitrary target environment keys', () => {
  expect(() => readSqlWorkerRuntimeConfig({
    ...baseEnvironment,
    OPS_DATABASE_EXPLORER_ENABLED: 'true',
    OPS_DATABASE_EDUTRACK_URL: 'postgresql://leak'
  })).toThrow(/Raw production credentials are forbidden/i);
});
```

Cover one enabled target, both enabled targets, disabled-by-default behavior, wrong role/database identity, one-target outage, maximum pool size two, missing policy approval credential, and target IDs absent from the closed union.

- [ ] **Step 2: Run focused worker tests and verify RED**

Run: `npx vitest run apps/sql-worker/src/runtime/runtimeConfig.test.ts apps/sql-worker/src/runtime/main.test.ts apps/sql-worker/src/runtime/commandHandler.test.ts apps/sql-worker/src/database/targetRegistry.test.ts`

Expected: FAIL because the explorer config and registry are missing.

- [ ] **Step 3: Add explicit per-target configuration**

Parse these variables; all enable flags default to `false` in the committed example:

```text
OPS_DATABASE_EXPLORER_ENABLED=false
OPS_DATABASE_EDUTRACK_ENABLED=false
OPS_DATABASE_EDUTRACK_URL_REFERENCE=ops-database-edutrack-reader-url
OPS_DATABASE_EDUTRACK_NAME=edutrack
OPS_DATABASE_EDUTRACK_ROLE=ops_database_browser
OPS_DATABASE_OPS_ENABLED=false
OPS_DATABASE_OPS_URL_REFERENCE=ops-database-ops-reader-url
OPS_DATABASE_OPS_NAME=edutrack_ops
OPS_DATABASE_OPS_ROLE=ops_database_browser
OPS_DATABASE_CURSOR_KEY_REFERENCE=ops-database-cursor-key
OPS_DATABASE_POLICY_APPROVAL_REFERENCE=ops-database-policy-approval
```

Reject corresponding raw URL/key environment variables. Load URLs, a 32-byte cursor key, and approval JSON only through `FileSecretResolver`.

- [ ] **Step 4: Implement the registry and independent target startup**

Each enabled target owns a `pg.Pool({ max: 2, application_name: 'edutrack-ops-database-explorer:<target>' })`. Validate TLS and identity before registering it healthy. Record a target-specific unavailable state on connection failure and never substitute the other target. Close every created pool exactly once during shutdown.

- [ ] **Step 5: Extend command dispatch without changing raw SQL semantics**

Add the three database command kinds. Validate `command.actor.role` again in the worker: all roles may invoke schema, while rows and related rows reject `ops_viewer` with `DATABASE_DATA_PERMISSION_DENIED`. Keep existing `schema.read`/`sql.*` commands intact so this feature does not silently change the older SQL rollout flags.

- [ ] **Step 6: Add systemd credentials and verify assets**

Add `LoadCredential=` entries for the two reader URLs, cursor key, and policy approval. The environment file contains references only. Update asset tests to prove no URL/key literal is committed and both target enable flags are false.

- [ ] **Step 7: Run worker/config/systemd tests**

Run: `npx vitest run apps/sql-worker/src/runtime apps/sql-worker/src/database/targetRegistry.test.ts deploy/ops/env/sql-worker.env.example.test.ts deploy/ops/systemd/systemd-assets.test.ts`

Expected: PASS, including an Ops-only registry serving schema while EduTrack is unavailable.

- [ ] **Step 8: Commit multi-target isolation**

```bash
git add apps/sql-worker/src packages/contracts/src/workerProtocol.ts deploy/ops/env/sql-worker.env.example deploy/ops/systemd
git commit -m "feat(database): add isolated explorer targets"
```

### Task 4: Produce target-aware schema snapshots and graph edges

**Files:**
- Modify: `apps/sql-worker/src/schema/introspectSchema.ts`
- Modify: `apps/sql-worker/src/schema/introspectSchema.test.ts`
- Create: `apps/sql-worker/src/explorer/schemaReader.ts`
- Create: `apps/sql-worker/src/explorer/schemaReader.test.ts`
- Modify: `packages/contracts/src/databaseSchema.ts`

**Interfaces:**
- Consumes: a registered target, `classifyColumn`, policy approval, and existing PostgreSQL catalog queries.
- Produces: `createExplorerSchemaReader(target): () => Promise<DatabaseExplorerSchemaSnapshot>` with incoming/outgoing edges, pagination keys, classifications, supported filters, and data availability.

- [ ] **Step 1: Write failing schema enrichment tests**

Construct catalog fixtures containing a primary key, nullable unique index, composite FK, materialized view, foreign table, RLS table, blocked column, and two schemas with the same relation name. Assert:

```ts
expect(snapshot.targetId).toBe('edutrack_production');
expect(snapshot.edges).toContainEqual({
  constraint: 'attendance_student_id_fkey',
  from: { schema: 'public', relation: 'attendance', columns: ['student_id'] },
  to: { schema: 'public', relation: 'students', columns: ['id'] }
});
expect(student.passwordHash).toMatchObject({ classification: 'blocked', selectable: false });
expect(nullableUnique.paginationKey).toBeNull();
expect(foreignTable.dataAvailable).toBe(false);
```

Also assert deterministic ordering/checksum and that system/temp schemas remain excluded.

- [ ] **Step 2: Run schema tests and verify RED**

Run: `npx vitest run apps/sql-worker/src/schema/introspectSchema.test.ts apps/sql-worker/src/explorer/schemaReader.test.ts`

Expected: FAIL because target identity, edges, classifications, and pagination metadata are absent.

- [ ] **Step 3: Extend catalog metadata**

Add estimated rows from `pg_class.reltuples`, ordered PK columns, valid non-null unique index candidates, and FK column ordinality. Preserve existing indexes/triggers/policies/RLS fields. Do not read comments or function/trigger bodies that may contain secrets.

- [ ] **Step 4: Build the explorer snapshot after checksum approval**

Compute the structural checksum first, call `assertPolicyApproved`, then enrich columns. Set `dataAvailable=false` for foreign tables, relations denied by policy, and relations with an unapproved snapshot. Choose the PK first, otherwise the shortest valid non-null unique index, as `paginationKey`.

- [ ] **Step 5: Keep cache isolation explicit**

Cache for 60 seconds using `targetId + role + database + structuralChecksum + policyVersion`. A target error clears only that target's cache. Never return one target's cached snapshot for the other.

- [ ] **Step 6: Run schema and command-handler tests**

Run: `npx vitest run apps/sql-worker/src/schema apps/sql-worker/src/explorer/schemaReader.test.ts apps/sql-worker/src/runtime/commandHandler.test.ts`

Expected: PASS with byte-for-byte stable snapshots from shuffled catalog fixtures.

- [ ] **Step 7: Commit schema enrichment**

```bash
git add apps/sql-worker/src/schema apps/sql-worker/src/explorer/schemaReader.ts apps/sql-worker/src/explorer/schemaReader.test.ts packages/contracts/src/databaseSchema.ts
git commit -m "feat(database): enrich explorer schema metadata"
```

### Task 5: Implement safe bounded rows, cursors, masking, and FK traversal

**Files:**
- Create: `apps/sql-worker/src/explorer/identifier.ts`
- Create: `apps/sql-worker/src/explorer/identifier.test.ts`
- Create: `apps/sql-worker/src/explorer/filterSql.ts`
- Create: `apps/sql-worker/src/explorer/filterSql.test.ts`
- Create: `apps/sql-worker/src/explorer/cursorCodec.ts`
- Create: `apps/sql-worker/src/explorer/cursorCodec.test.ts`
- Create: `apps/sql-worker/src/explorer/valueEncoding.ts`
- Create: `apps/sql-worker/src/explorer/valueEncoding.test.ts`
- Create: `apps/sql-worker/src/explorer/rowReader.ts`
- Create: `apps/sql-worker/src/explorer/rowReader.test.ts`
- Create: `apps/sql-worker/src/explorer/relatedRowReader.ts`
- Create: `apps/sql-worker/src/explorer/relatedRowReader.test.ts`
- Modify: `apps/sql-worker/src/runtime/commandHandler.ts`

**Interfaces:**
- Consumes: approved explorer snapshot, target pool, cursor key, `DatabaseRowsRequest`, and `DatabaseRelatedRowsRequest`.
- Produces: `readDatabaseRows(input): Promise<DatabaseRowsResponse>`, `readRelatedRows(input)`, authenticated cursors, and authenticated row references.

- [ ] **Step 1: Write failing identifier, parameterization, and filter tests**

```ts
it('quotes only snapshot-resolved identifiers and parameterizes values', () => {
  const built = buildRowsQuery({
    snapshot: fixtureWithRelation('Odd Schema', 'select', ['display"name']),
    schema: 'Odd Schema', relation: 'select', pageSize: 25,
    filters: [{ column: 'display"name', operator: 'eq', value: "x' OR true --" }]
  });
  expect(built.text).toContain('"Odd Schema"."select"');
  expect(built.text).toContain('"display""name" = $1');
  expect(built.text).not.toContain("x' OR true --");
  expect(built.values).toEqual(["x' OR true --"]);
});
```

Test every operator/type pair, five-filter/200-character limits, missing value rules for null operators, rejected blocked-column filters, unsupported types, Unicode, and an identifier absent from the snapshot.

- [ ] **Step 2: Write failing cursor and stable-order tests**

Test HMAC tampering, wrong target/schema/relation/checksum, five-minute expiry, size over 4 KiB, nullable sort columns, duplicate sort values, composite keys, ascending/descending order, and best-effort offset refusal beyond 10,000 rows.

- [ ] **Step 3: Write failing masking and encoding boundary tests**

Prove blocked columns are absent from the generated `SELECT` list, masked PII never appears in returned JSON, reveal returns PII only when `piiMode='revealed'`, a 64 KiB scalar becomes a tagged truncated cell, `bytea` returns byte length plus SHA-256 only, and the encoded response stops before 2 MiB with `truncated=true`.

- [ ] **Step 4: Implement identifier resolution and typed filters**

Use one helper only:

```ts
export const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;
```

Call it only after exact lookup in the snapshot. Build values as `$1`, `$2`, and so on. Map PostgreSQL types to text/numeric/temporal/boolean/enum/json/other filter families and reject unsupported combinations with `DATABASE_FILTER_INVALID`.

- [ ] **Step 5: Implement authenticated cursor and row-ref codecs**

Encode canonical JSON plus HMAC-SHA256 using the separate 32-byte cursor key. Include version, kind, target, schema, relation, schema checksum, issued/expiry time, sort definition, and key/offset state. A `rowRef` includes only pagination-key column values needed for FK traversal and is never logged.

- [ ] **Step 6: Implement the read transaction**

On one checked-out connection execute:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
-- one generated SELECT with pageSize + 1 and parameter values
ROLLBACK;
```

Always roll back in `finally`, release once, and translate timeout/cancel errors to `DATABASE_QUERY_TIMEOUT`. Select only policy-allowed columns. Fetch `pageSize + 1`, encode at most `pageSize`, and return a cursor only when more data exists.

- [ ] **Step 7: Implement FK traversal from trusted metadata**

Decode the source `rowRef`, resolve the named FK edge from the same snapshot checksum, and generate equality predicates from its ordered column pairs. Reject wrong-direction/missing constraints and rows without the needed stable key. Return the ordinary bounded response for the target relation.

- [ ] **Step 8: Run the complete explorer worker suite**

Run: `npx vitest run apps/sql-worker/src/explorer apps/sql-worker/src/runtime/commandHandler.test.ts`

Expected: PASS, including all five Review Focus cases owned by the worker.

- [ ] **Step 9: Commit bounded data access**

```bash
git add apps/sql-worker/src/explorer apps/sql-worker/src/runtime/commandHandler.ts apps/sql-worker/src/runtime/commandHandler.test.ts
git commit -m "feat(database): read bounded masked table pages"
```

### Task 6: Add API authorization, PII step-up, validation, and audit

**Files:**
- Create: `packages/db/migrations/0022_database_pii_reveal.sql`
- Modify: `packages/db/src/schema/auth.ts`
- Modify: `apps/api/src/modules/auth/stepUpService.ts`
- Modify: `apps/api/src/modules/auth/stepUpService.test.ts`
- Modify: `apps/api/src/modules/auth/postgresStepUpRepository.ts`
- Modify: `apps/api/src/modules/auth/postgresStepUpRepository.test.ts`
- Create: `apps/api/src/modules/database/databaseSchemas.ts`
- Create: `apps/api/src/modules/database/databaseExplorerService.ts`
- Create: `apps/api/src/modules/database/databaseExplorerService.test.ts`
- Create: `apps/api/src/modules/database/databaseRoutes.ts`
- Create: `apps/api/src/modules/database/databaseRoutes.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/index.test.ts`
- Modify: `apps/api/src/runtime/createOpsApiRuntime.ts`
- Modify: `apps/api/src/runtime/createOpsApiRuntime.test.ts`
- Delete: `apps/api/src/modules/database/schemaRoutes.ts`
- Delete: `apps/api/src/modules/database/schemaRoutes.test.ts`

**Interfaces:**
- Consumes: explorer DTOs, `SqlWorkerClient`, `StepUpService`, `PostgresOpsAuditLedger`, session authorization, and database permissions.
- Produces: the six HTTP endpoints in the spec, persistent `database_pii` grants, and fail-closed audit orchestration.

- [ ] **Step 1: Write the migration and failing step-up tests**

The migration replaces the `ops_secret_elevations.capability` check so it accepts exactly `accounts_write`, `variables_secret`, `variables_apply`, and `database_pii`. Update the reusable expression so `variables_secret` and `database_pii` are reusable. Test a ten-minute lifetime capped by session expiry, replacement of older same-target grants, and rejection of cross-target subject digests.

```ts
const granted = await service.grant({
  capability: 'database_pii', subjectDigest: digest('edutrack_production'), ...baseProof
});
expect(Date.parse(granted.expiresAt) - Date.parse(granted.grantedAt)).toBe(600_000);
expect(granted.reusable).toBe(true);
```

- [ ] **Step 2: Run auth/migration tests and verify RED**

Run: `npx vitest run apps/api/src/modules/auth/stepUpService.test.ts apps/api/src/modules/auth/postgresStepUpRepository.test.ts packages/db/src/schema`

Expected: FAIL because `database_pii` is not an accepted capability.

- [ ] **Step 3: Implement the Zod request/response boundary**

Parse closed target IDs, identifiers of 1–63 non-control characters, page sizes 25/50/100, no more than five strict filter objects, values at most 200 characters, strict sort direction, cursors/rowRefs at most 4096 characters, reveal password at most 256 characters, six-digit TOTP, and reason length 10–500. Use `.strict()` on every object and validate worker responses before returning them.

- [ ] **Step 4: Write failing route/service authorization tests**

Cover:

- all roles can list targets/read schema;
- viewer row and reveal requests return 403 without calling the worker;
- maintainer/owner row calls default to `piiMode='masked'`;
- revealed mode requires an active grant bound to user/session/IP/user-agent/target;
- row POSTs without valid CSRF return 401;
- invalid worker response returns 503 without leaking it;
- audit append failure returns 503 and discards the worker result;
- timeout/stale/invalid cursor codes map to stable HTTP responses;
- every response uses `Cache-Control: no-store`.

- [ ] **Step 5: Implement service ordering and audit**

The service order is: authorize -> permission -> parse -> resolve reveal binding -> call worker -> validate response -> append audit -> return. Use filter/sort SHA-256 fingerprints only. Never place SQL, values, row refs, cursor bodies, or row data in audit metadata.

Append `database.rows_viewed` for every masked page and both `database.rows_viewed` plus `database.pii_rows_viewed` for a revealed page. If either append fails, return `DATABASE_AUDIT_UNAVAILABLE` and do not send rows.

- [ ] **Step 6: Implement reveal grant and revoke routes**

Resolve the user's current TOTP factor, grant `database_pii` using `subjectDigest=sha256(targetId)`, store no password/TOTP, append `database.pii_reveal_granted` with reason and expiry, and return only `{ targetId, expiresAt }`. `DELETE /pii-reveal` revokes the active binding and appends `database.pii_reveal_revoked`.

- [ ] **Step 7: Replace the single-schema router and wire runtime dependencies**

Mount `createDatabaseRouter` at `/api/v1/database`. Remove the old single-target router after its viewer-schema behavior is covered by `GET /targets/:targetId/schema`. Inject worker, step-up repository/service, audit ledger, session authorization, IP/user-agent hashing, and target configuration from `createOpsApiRuntime`.

- [ ] **Step 8: Run API, auth, and integration tests**

Run: `npx vitest run apps/api/src/modules/database apps/api/src/modules/auth apps/api/src/index.test.ts apps/api/src/runtime/createOpsApiRuntime.test.ts packages/db/src/schema`

Expected: PASS, including expired/revoked/wrong-binding reveal cases and audit fail-closed behavior.

- [ ] **Step 9: Commit the API security layer**

```bash
git add packages/db apps/api/src/modules/auth apps/api/src/modules/database apps/api/src/index.ts apps/api/src/index.test.ts apps/api/src/runtime/createOpsApiRuntime.ts apps/api/src/runtime/createOpsApiRuntime.test.ts
git commit -m "feat(database): authorize and audit explorer access"
```

### Task 7: Provision database-enforced browser roles and policy verification

**Files:**
- Create: `deploy/postgres/003_database_explorer_roles.sql`
- Create: `deploy/postgres/render-database-explorer-grants.ts`
- Create: `deploy/postgres/render-database-explorer-grants.test.ts`
- Create: `deploy/postgres/verify-database-explorer-role.ts`
- Create: `deploy/postgres/verify-database-explorer-role.test.ts`
- Modify: `deploy/postgres/apply-role-grants.sh`
- Create: `docs/runbooks/database-explorer-rollout.md`
- Modify: `docs/runbooks/sql-role-rotation.md`

**Interfaces:**
- Consumes: target database/app-owner/login names, structural schema snapshots, policy approval, and the shared `classifyColumn` function.
- Produces: `ops_database_browser`/login roles with column-level SELECT only, verification JSON, and repeatable provisioning/rotation commands.

- [ ] **Step 1: Write failing SQL artifact and verifier tests**

Assert the SQL creates `NOLOGIN` capability and `LOGIN` roles without superuser, createdb, createrole, replication, or bypassrls; sets `default_transaction_read_only=on`; revokes TEMP/CREATE/function execution; grants schema usage; and grants column-level SELECT excluding blocked names.

The grant-renderer and verifier tests must simulate:

- successful SELECT from a safe column;
- permission denied for a password/token/OTP/secret column;
- permission denied for INSERT/UPDATE/DELETE/CREATE TEMP/FUNCTION/COPY PROGRAM;
- exact role/database identity and TLS mode;
- no inherited owner/superuser role;
- default privileges do not auto-grant a newly created column.

- [ ] **Step 2: Run deployment tests and verify RED**

Run: `npx vitest run deploy/postgres/verify-database-explorer-role.test.ts deploy/postgres/verify-readonly-role.test.ts`

Expected: FAIL because the explorer role artifacts do not exist.

- [ ] **Step 3: Implement idempotent least-privilege roles and generated grants**

Use psql variables for database, app owner, capability role, login role, and rotated login. The SQL file creates/locks down roles and revokes inherited PUBLIC privileges but grants no table access by itself. `render-database-explorer-grants.ts` reads an approved structural snapshot, imports the same `classifyColumn` function used by the worker, emits safely quoted `GRANT SELECT (col1, col2, ...) ON schema.table` statements excluding blocked columns, and emits no row values. Grant no sequence or function privileges. New tables/columns receive no explorer grants until the policy report is reviewed, its checksum approved, and the renderer is rerun.

- [ ] **Step 4: Implement the executable verifier**

Return nonzero on any identity, capability, mutation, blocked-column, RLS, or TLS failure. Emit only codes/counts and hashed object identifiers; never print DSNs, usernames embedded in DSNs, sample values, or exception connection details.

- [ ] **Step 5: Update apply/rotation and rollout runbooks**

Document exact order: render policy report -> review classifications -> apply role grants on each target -> run verifier on each target -> capture approved checksums -> install credentials -> enable Ops target for owner -> observe -> enable EduTrack target for owner -> observe -> enable maintainers. Include rollback by flipping both target enable flags false and restarting only the SQL worker/API bridge.

- [ ] **Step 6: Run deployment and secret-scan tests**

Run: `npx vitest run deploy/postgres scripts/scan-evidence-secrets.test.ts`

Expected: PASS with no credential material in output fixtures.

- [ ] **Step 7: Commit database enforcement**

```bash
git add deploy/postgres docs/runbooks/database-explorer-rollout.md docs/runbooks/sql-role-rotation.md
git commit -m "feat(database): provision explorer read roles"
```

### Task 8: Add web routing, API client, target state, and privacy unlock

**Files:**
- Modify: `apps/web/src/web/routing.ts`
- Create: `apps/web/src/web/routing.test.ts`
- Modify: `apps/web/src/web/App.tsx`
- Modify: `apps/web/src/web/App.test.tsx`
- Modify: `apps/web/src/web/components/OpsShell.tsx`
- Modify: `apps/web/src/web/api.ts`
- Create: `apps/web/src/web/features/database/databaseApi.ts`
- Create: `apps/web/src/web/features/database/databaseApi.test.ts`
- Create: `apps/web/src/web/features/database/useDatabaseExplorer.ts`
- Create: `apps/web/src/web/features/database/useDatabaseExplorer.test.tsx`
- Create: `apps/web/src/web/features/database/PiiRevealDialog.tsx`
- Create: `apps/web/src/web/features/database/PiiRevealDialog.test.tsx`
- Create: `apps/web/src/web/pages/DatabasePage.tsx`
- Create: `apps/web/src/web/pages/DatabasePage.test.tsx`

**Interfaces:**
- Consumes: the six HTTP endpoints and `SessionInfo` with canonical Ops roles.
- Produces: `/database`, the Database nav item, client functions, page state, target reset behavior, and privacy reveal/hide/countdown UX.

- [ ] **Step 1: Write failing route/shell tests**

Assert `/database` normalizes as an `OpsRoute`, all authenticated roles see the Database nav item, the route mounts `DatabasePage`, and unknown paths still return `/`. Assert there is no text/button matching `SQL`, `Export`, `Edit`, `Insert`, or `Delete` on the page.

- [ ] **Step 2: Write failing client and state tests**

Test exact URLs/methods, CSRF headers on row/relation/reveal/hide POST/DELETE calls, strict no-store request behavior, and 401 forwarding. Test that switching target clears schema selection, rows, cursor stack, filters, sort, selected cell, graph expansion, and reveal deadline before requesting the new schema.

- [ ] **Step 3: Implement typed API functions**

Add `getDatabaseTargets`, `getDatabaseSchema`, `queryDatabaseRows`, `queryRelatedRows`, `revealDatabasePii`, and `hideDatabasePii`. Keep database-specific code in `features/database/databaseApi.ts`; reuse the shared `request` error behavior.

- [ ] **Step 4: Implement route, navigation, and page state**

Add the `Database` nav button after `Variables`. The page initially loads targets, selects the first available target, then loads its schema. Use an `AbortController` or generation token so a slow response from the previous target/relation cannot overwrite the new selection.

- [ ] **Step 5: Implement privacy reveal dialog**

Require password, six-digit TOTP, and 10–500 character reason. Clear password/TOTP immediately after submit and on close. Display target name and ten-minute countdown. At expiry, target change, logout, or “Ẩn dữ liệu nhạy cảm”, clear rows first, revoke/forget the grant, then reload masked rows.

- [ ] **Step 6: Run route/client/state/privacy tests**

Run: `npx vitest run apps/web/src/web/routing.test.ts apps/web/src/web/App.test.tsx apps/web/src/web/features/database apps/web/src/web/pages/DatabasePage.test.tsx`

Expected: PASS with no row/reveal state surviving a target change.

- [ ] **Step 7: Commit the page shell**

```bash
git add apps/web/src/web
git commit -m "feat(database): add explorer route and privacy state"
```

### Task 9: Build schema tree, structure details, filters, grid, and FK navigation

**Files:**
- Create: `apps/web/src/web/features/database/SchemaTree.tsx`
- Create: `apps/web/src/web/features/database/SchemaTree.test.tsx`
- Create: `apps/web/src/web/features/database/StructurePanel.tsx`
- Create: `apps/web/src/web/features/database/StructurePanel.test.tsx`
- Create: `apps/web/src/web/features/database/FilterBar.tsx`
- Create: `apps/web/src/web/features/database/FilterBar.test.tsx`
- Create: `apps/web/src/web/features/database/DataGrid.tsx`
- Create: `apps/web/src/web/features/database/DataGrid.test.tsx`
- Create: `apps/web/src/web/features/database/CellDetailDialog.tsx`
- Create: `apps/web/src/web/features/database/CellDetailDialog.test.tsx`
- Create: `apps/web/src/web/features/database/RelatedRowsDrawer.tsx`
- Create: `apps/web/src/web/features/database/RelatedRowsDrawer.test.tsx`
- Modify: `apps/web/src/web/pages/DatabasePage.tsx`
- Modify: `apps/web/src/web/pages/DatabasePage.test.tsx`
- Modify: `apps/web/src/web/styles.css`

**Interfaces:**
- Consumes: explorer state/actions and schema/row/relation DTOs.
- Produces: searchable schema navigation, structure tab, typed filters, bounded grid, cursor pagination, cell detail, and relationship navigation.

- [ ] **Step 1: Write failing schema tree and structure tests**

Test case-insensitive Vietnamese-safe search across schema/relation names, relation-kind badges, keyboard selection, counts, PK/FK/index/trigger/RLS sections, blocked/PII badges, and an accessible no-results state. Viewer selection must load structure but make no row request.

- [ ] **Step 2: Write failing filter and pagination tests**

Test operator options by column type, maximum five filters, 200-character validation, null operators without values, sort toggling, 25/50/100 page size, next/previous cursor stack, reset on filter/sort change, best-effort warning, stale-cursor reload, and no filter control for blocked columns.

- [ ] **Step 3: Write failing cell and FK tests**

Assert tagged blocked/masked/truncated/value cells render without unsafe coercion; JSON uses `<pre>` text rather than HTML; masked cells have no raw value in DOM; bytea shows only digest/size; long cells open an accessible dialog; and FK buttons call the relation endpoint with `rowRef` plus constraint name rather than constructing filters from DOM text.

- [ ] **Step 4: Implement tree and structure components**

Group relations under schema disclosure controls and preserve selection by `schema + relation`. Show columns, data types, nullable/default/generated/identity, constraints, indexes, triggers, policies, RLS, estimated rows, pagination key, and policy classification.

- [ ] **Step 5: Implement bounded grid and controls**

Use a horizontally scrollable semantic `<table>` with sticky header and at most 100 DOM rows. Provide explicit loading/error/empty states, sortable buttons with `aria-sort`, filter labels, page-size selector, and previous/next controls. Never use `dangerouslySetInnerHTML` for values.

- [ ] **Step 6: Implement cell detail and related-row drawer**

Render scalar/JSON values as text, copy only the currently visible value, and disable copy for blocked/masked cells. The related drawer shows constraint direction/columns and another bounded grid; closing it discards its cursor stack and rows.

- [ ] **Step 7: Add responsive styles**

Use a three-column desktop layout (tree/content/privacy), collapse to one column below 900px, preserve horizontal grid scrolling, keep focus rings visible, and ensure badges are not color-only.

- [ ] **Step 8: Run component and page tests**

Run: `npx vitest run apps/web/src/web/features/database apps/web/src/web/pages/DatabasePage.test.tsx`

Expected: PASS for viewer, masked maintainer, revealed owner, empty, timeout, stale schema, and unavailable target fixtures.

- [ ] **Step 9: Commit table browsing UX**

```bash
git add apps/web/src/web/features/database apps/web/src/web/pages/DatabasePage.tsx apps/web/src/web/pages/DatabasePage.test.tsx apps/web/src/web/styles.css
git commit -m "feat(database): browse tables and related rows"
```

### Task 10: Add focused relationships and full ERD

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Create: `apps/web/src/web/features/database/graphModel.ts`
- Create: `apps/web/src/web/features/database/graphModel.test.ts`
- Create: `apps/web/src/web/features/database/RelationshipGraph.tsx`
- Create: `apps/web/src/web/features/database/RelationshipGraph.test.tsx`
- Create: `apps/web/src/web/features/database/FullErd.tsx`
- Create: `apps/web/src/web/features/database/FullErd.test.tsx`
- Modify: `apps/web/src/web/pages/DatabasePage.tsx`
- Modify: `apps/web/src/web/pages/DatabasePage.test.tsx`
- Modify: `apps/web/src/web/styles.css`

**Interfaces:**
- Consumes: `DatabaseRelationEdge[]`, relation metadata, selected relation, and search text.
- Produces: deterministic graph nodes/edges, one-hop incremental focus graph, full schema-grouped ERD, and a non-canvas accessible relationship list.

- [ ] **Step 1: Install pinned graph/layout dependencies**

Run: `npm install @xyflow/react@12.12.0 @dagrejs/dagre@3.1.1 --workspace @edutrack-ops/web`

Expected: `apps/web/package.json` and `package-lock.json` pin both packages; React 19 peer requirements remain satisfied.

- [ ] **Step 2: Write failing graph-model tests**

Test relation IDs include target/schema/name, duplicate table names across schemas do not collide, self-FKs render once, composite FKs retain ordered column labels, one-hop focus excludes unrelated nodes, expansion is additive, search is deterministic, and shuffled snapshots produce identical nodes/edges/layout inputs.

- [ ] **Step 3: Write failing component/accessibility tests**

Test selected-node emphasis, incoming/outgoing edge labels, expand/reset controls, click-to-select relation, full-ERD schema groups, search dim/hide behavior, fit-view control, empty graph, and a semantic list/table containing the same relationships for keyboard and screen-reader users.

- [ ] **Step 4: Implement pure graph projection and Dagre layout**

Keep graph transformation in `graphModel.ts`; components receive ready nodes/edges. Focused nodes show key columns and FK endpoints. Full-ERD nodes initially show relation name, kind, PK, and column count; selected nodes may expand columns. Use left-to-right layout for focused mode and top-to-bottom grouped layout for full mode.

- [ ] **Step 5: Implement React Flow views**

Import `@xyflow/react/dist/style.css`, enable pan/zoom/fit view, disable node dragging persistence, and never store graph state outside session memory. Selecting a graph node updates the same page relation selection and clears row cursors before data reload.

- [ ] **Step 6: Run graph/page/build tests**

Run: `npx vitest run apps/web/src/web/features/database/graphModel.test.ts apps/web/src/web/features/database/RelationshipGraph.test.tsx apps/web/src/web/features/database/FullErd.test.tsx apps/web/src/web/pages/DatabasePage.test.tsx && npm run build --workspace @edutrack-ops/web`

Expected: PASS and a production web build without Node polyfills or credential strings.

- [ ] **Step 7: Commit relationship visualization**

```bash
git add apps/web/package.json package-lock.json apps/web/src/web/features/database apps/web/src/web/pages/DatabasePage.tsx apps/web/src/web/pages/DatabasePage.test.tsx apps/web/src/web/styles.css
git commit -m "feat(database): visualize table relationships"
```

### Task 11: Prove end-to-end safety, performance, accessibility, and staged rollout

**Files:**
- Create: `apps/web/e2e/database-explorer.spec.ts`
- Create: `apps/sql-worker/src/security/databaseExplorerBypass.test.ts`
- Create: `apps/sql-worker/src/security/databaseExplorerBounds.test.ts`
- Create: `apps/api/src/modules/database/databaseAudit.integration.test.ts`
- Modify: `deploy/ops/prepare-release.sh`
- Modify: `deploy/ops/release-assets.test.ts`
- Modify: `docs/runbooks/database-explorer-rollout.md`

**Interfaces:**
- Consumes: the complete feature, deployment artifacts, two database fixtures, and role verifier.
- Produces: browser/worker/database evidence for read-only enforcement, data privacy, target isolation, audit completeness, and rollout readiness.

- [ ] **Step 1: Write the Playwright flow before enabling the feature**

Cover owner login + MFA, target list, both schema trees, Production masked rows, reveal dialog with reason, countdown, revealed PII, FK navigation, explicit hide/remask, focused graph, full ERD search, target reset, refresh without persisted rows, and logout. In a second context, prove viewer sees both schemas/graphs but gets no Data request or reveal control.

- [ ] **Step 2: Write worker/database bypass tests**

Using the real browser-reader fixture role, attempt INSERT, UPDATE, DELETE, TRUNCATE, CREATE TEMP TABLE, CREATE FUNCTION, COPY PROGRAM, role change, transaction mode change, and direct SELECT of each blocked corpus column. Require permission/read-only rejection and unchanged table checksums. Send forged worker payloads for a third target, raw SQL field, viewer row command, tampered cursor, and cross-target rowRef; require rejection before query execution.

- [ ] **Step 3: Write boundary/load tests**

Generate 101 relations, 210 FK edges, 100 rows × wide columns, 64 KiB cells, a response crossing 2 MiB, five filters, duplicate/nullable keys, and a timeout query fixture. Assert bounded memory/output, no sixth filter, stable cursors, valid JSON, timeout rollback/release, and deterministic ERD projection.

- [ ] **Step 4: Write audit integration tests**

Assert masked/revealed pages produce the required ordered audit actions with actor/target/relation/count/policy/checksum fingerprints, no values/filter text/cursors/rowRefs/SQL, and a valid hash chain. Force audit persistence failure and assert zero row bytes reach the HTTP response body.

- [ ] **Step 5: Run the complete local quality gate**

Run:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e --workspace @edutrack-ops/web -- database-explorer.spec.ts
```

Expected: every command exits 0; Playwright records no raw blocked value in DOM, network fixtures, trace attachments, screenshots, or browser storage.

- [ ] **Step 6: Validate disabled release artifacts**

Run: `bash deploy/ops/prepare-release.sh`

Expected: release contains updated API/worker/web assets, both target enable flags remain false, credentials are references/systemd credentials only, and existing Overview/Issues/Variables/Users smoke checks still pass.

- [ ] **Step 7: Execute the staged production gate from the runbook**

Provision and verify both browser roles; capture and review policy reports; install the signed approval credential; enable `ops` for one owner; verify audit/query latency/timeouts for 24 hours; enable `edutrack_production` for one owner; observe another 24 hours; then enable maintainer data access. Keep viewer data access disabled. Roll back any stage by disabling the affected target and restarting the SQL worker/API bridge, without changing other Ops pages.

- [ ] **Step 8: Commit final evidence and rollout docs**

```bash
git add apps/web/e2e/database-explorer.spec.ts apps/sql-worker/src/security apps/api/src/modules/database/databaseAudit.integration.test.ts deploy/ops docs/runbooks/database-explorer-rollout.md
git commit -m "test(database): prove explorer read only rollout"
```

## Final verification checklist

- [ ] Browser bundles and network responses contain no database credential, SQL text, blocked value, or unmasked PII before reveal.
- [ ] Both database roles reject mutation and blocked-column reads independently of API/worker checks.
- [ ] Target identity mismatch, outage, and schema drift fail only the requested target and never fall back.
- [ ] Every returned row page has a completed append-only audit record before response delivery.
- [ ] PII reveal is bound to user/session/IP/user-agent/target, expires within ten minutes, and clears on hide/target switch/logout.
- [ ] A viewer can use both relationship modes but cannot cause a row worker command.
- [ ] The 101-table/210-edge full ERD remains searchable and usable at desktop and mobile widths.
- [ ] Existing Ops routes and monitoring remain functional when either explored database is unavailable.
