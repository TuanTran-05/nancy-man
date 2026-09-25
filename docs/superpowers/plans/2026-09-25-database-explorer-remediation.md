# Database Explorer Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Repair the existing Database Explorer in place so its production runtime, privacy, navigation, database enforcement, test evidence, and rollout match the approved design.

**Architecture:** Keep the closed two-target design and private SQL worker. Use confidential authenticated cursors, a fresh structural checksum before every row read, ordered FK metadata, real target readers and health, and server-side PII grant lookup. Preserve database-level column grants and default-off gates; prove enforcement with ephemeral PostgreSQL and exercise the complete local API/worker/web stack before any external staged observation.

**Tech Stack:** TypeScript 5.8, Node.js 22, Express 5, PostgreSQL 16, pg, Zod, React 19, Vitest 4, Testing Library, Playwright 1.59, systemd.

**Spec:** docs/superpowers/specs/2026-09-25-database-explorer-design.md

## Global Constraints

- The only target IDs are edutrack_production and ops; the browser cannot submit a URL or arbitrary database name.
- ops_viewer may read schema and relationships only; ops_maintainer and ops_owner may browse bounded rows.
- PII is masked by default; every revealed page requires a valid server-side database_pii grant.
- Blocked secret columns are excluded from SELECT lists and never appear in worker/API responses, including malformed worker results.
- Each target uses a separate TLS verify-full pool, expected database and LOGIN role identity, default_transaction_read_only=on, and pool maximum two.
- Each row request allows at most five filters, values up to 200 characters, and page sizes 25/50/100; statement timeout is 15 seconds, lock timeout two seconds, response maximum 2 MiB, scalar cell maximum 64 KiB.
- Cursors and rowRefs are confidential, authenticated, at most 4 KiB, expire within five minutes, and bind target, schema, relation, and structural checksum.
- No raw SQL, export, mutation, DDL, cross-target join, or browser credential surface is added.
- Row and reveal HTTP responses use Cache-Control: no-store. Never log row values, PII, cursor/rowRef contents, SQL, or grant bearer material.
- Audit append and revoke failures fail closed; no data or reveal-success response is returned on those failures.
- Feature, API-to-worker bridge, and target flags remain false in committed defaults. Local tests never count as production observation.

## Review Focus

- A schema change after metadata load must be caught before a row SELECT; Task 1 tests checksum drift and cache invalidation.
- Duplicate and nullable sort values, including composite keys, must not skip or repeat rows; Task 1 tests ascending and descending page boundaries.
- Composite FK columns must remain paired and traversal must work from either endpoint; Tasks 2 and 5 test worker mapping and browser requests.
- Hide, expiry, target switch, and revoke/audit failure must clear every sensitive layer before another request; Task 5 tests delayed responses and request order.
- Disabled, unavailable, and healthy target status must match worker registry state while every default-off gate remains dark; Tasks 3, 4, and 6 test these states.

## Dependency and Execution Order

Task 1 establishes secure tokens, query semantics, schema freshness, and policy. Task 2 adds ordered FK metadata and encrypted row traversal; Task 3 wires those readers into production worker runtime and exposes target health. Task 4 consumes the worker status/results and implements API parsing, PII binding, and audit. Task 5 completes the browser privacy and relationship flows. Task 6 repairs provisioning and deployment commands. Task 7 depends on Tasks 1–6 and proves database enforcement against ephemeral PostgreSQL. Task 8 depends on all prior tasks and proves the complete API/worker/web flow; it also defines the local completion and separate external rollout gate.

---

### Task 1: Secure tokens and make schema-bound query semantics correct

**Files:**

- Modify: apps/sql-worker/src/explorer/cursorCodec.ts
- Modify: apps/sql-worker/src/explorer/cursorCodec.test.ts
- Modify: apps/sql-worker/src/explorer/schemaReader.ts
- Modify: apps/sql-worker/src/explorer/schemaReader.test.ts
- Modify: apps/sql-worker/src/explorer/filterSql.ts
- Modify: apps/sql-worker/src/explorer/filterSql.test.ts
- Modify: apps/sql-worker/src/explorer/rowReader.ts
- Modify: apps/sql-worker/src/explorer/rowReader.test.ts
- Modify: apps/sql-worker/src/runtime/main.ts
- Modify: apps/sql-worker/src/runtime/main.test.ts
- Modify: apps/sql-worker/src/runtime/runtimeConfig.test.ts
- Modify: packages/contracts/src/databaseExplorer.ts
- Modify: packages/security/src/database/columnPolicy.ts
- Modify: packages/security/src/database/columnPolicyManifest.ts
- Modify: packages/security/src/database/columnPolicy.test.ts

**Interfaces:**

- Consumes: existing FileSecretResolver reference ops-database-cursor-key, schema snapshots, and bounded row request types.
- Produces: confidential encodeCursor/decodeCursor and encodeRowRef/decodeRowRef; a target-specific schema reader that can refresh current structural checksum before every row query; cursor continuation bound to sort, null order, target, schema, relation, and checksum.
- The existing credential reference remains unchanged. Its value becomes canonical standard Base64 for exactly 32 random bytes, decoded and HKDF-derived with separate cursor/v2 and row-ref/v2 labels.

- [ ] **Step 1: Add failing token, drift, pagination, filter, and policy tests**

In cursorCodec.test.ts, encode known sort/FK marker values and assert no marker is present in base64url-decoded token segments. Assert round trip, wrong-key/tamper rejection, target/schema/relation/checksum mismatch, five-minute expiry for both token types, and rejection above 4096 bytes. In schemaReader/rowReader tests, load metadata, change the catalog checksum, issue a row query, and assert DATABASE_SCHEMA_STALE before any row SELECT. Test that cursors cannot be reused after changing the sort definition.

Test ascending and descending pages with duplicate sort values, nullable sort values, and composite non-null keys; concatenated pages must equal the ordered source rows exactly once. Test the 10,000-row offset ceiling. Test enum columns support eq, neq, is_null, and is_not_null; preserve the spec operator matrix for text, numeric, temporal, and boolean columns. Add PII corpus names for given/first/middle/family/last/preferred/legal name, date_of_birth/birth_date/dob, email/phone/mobile, address parts, notes/comments/messages/free-form content, and raw payload; blocked patterns must win over PII/public patterns.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: npx vitest run apps/sql-worker/src/explorer/cursorCodec.test.ts apps/sql-worker/src/explorer/schemaReader.test.ts apps/sql-worker/src/explorer/filterSql.test.ts apps/sql-worker/src/explorer/rowReader.test.ts apps/sql-worker/src/runtime/runtimeConfig.test.ts packages/security/src/database/columnPolicy.test.ts

Expected: FAIL because tokens expose base64url JSON, schema freshness is TTL-only, null cursor continuation is unsafe, enums lack operators, and PII name coverage is narrow.

- [ ] **Step 3: Implement confidential AEAD tokens and exact key migration**

Use AES-256-GCM with a random 96-bit nonce, authenticated version/kind and context AAD, and distinct HKDF-SHA-256 keys for cursor and rowRef. Check encoded byte length before decrypting, authenticate before JSON parsing, validate decoded structure and expiry, then compare target/schema/relation/checksum. Add issuedAt/expiresAt to rowRefs. Errors and telemetry contain only stable codes; never attach token text, claims, sort values, or FK values.

Keep the FileSecretResolver credential name/path. Replace its contents with openssl rand -base64 32 output, mode 0600, and restart the worker. Reject old v1 plaintext-HMAC tokens as DATABASE_CURSOR_INVALID; cursors live only in browser memory and the page reloads from page one after restart. Do not retain a plaintext-token fallback.

- [ ] **Step 4: Implement query semantics and policy**

Before every rows or relatedRows SELECT, compute a fresh target-specific structural checksum and compare it with the approved snapshot; invalidate only that target cache and fail DATABASE_SCHEMA_STALE before selecting data on mismatch. Keep schema display cache at most 60 seconds.

Build stable ordering as requested sort followed by the complete stable key, with a fixed explicit null order. Generate expanded lexicographic predicates for null and equal-prefix cases, and require the cursor sort/null-order to match the new request. Discover PostgreSQL enum types and expose equality/inequality plus null checks. Broaden boundary-aware PII patterns for person names, birth dates, contact/address fields, free-form text, and raw payload; exact blocked/name rules retain precedence. Bump DATABASE_POLICY_VERSION when these reviewed rules change.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: npx vitest run apps/sql-worker/src/explorer/cursorCodec.test.ts apps/sql-worker/src/explorer/schemaReader.test.ts apps/sql-worker/src/explorer/filterSql.test.ts apps/sql-worker/src/explorer/rowReader.test.ts apps/sql-worker/src/runtime/runtimeConfig.test.ts packages/security/src/database

Expected: PASS; tokens conceal payloads, drift blocks before SELECT, nullable/duplicate pages neither skip nor repeat rows, and filter/policy behavior matches the spec.

- [ ] **Step 6: Commit**

~~~bash
git add apps/sql-worker/src/explorer/cursorCodec.ts apps/sql-worker/src/explorer/cursorCodec.test.ts apps/sql-worker/src/explorer/schemaReader.ts apps/sql-worker/src/explorer/schemaReader.test.ts apps/sql-worker/src/explorer/filterSql.ts apps/sql-worker/src/explorer/filterSql.test.ts apps/sql-worker/src/explorer/rowReader.ts apps/sql-worker/src/explorer/rowReader.test.ts apps/sql-worker/src/runtime/main.ts apps/sql-worker/src/runtime/main.test.ts apps/sql-worker/src/runtime/runtimeConfig.test.ts packages/contracts/src/databaseExplorer.ts packages/security/src/database
git commit -m "fix(database): secure tokens and schema-bound queries"
~~~

**Acceptance:** Cursor and rowRef are confidential, authenticated, context-bound, <=4 KiB, and <=5 minutes. Query checks live schema before data access and meets nullable/duplicate pagination, enum-filter, and conservative classification requirements.

### Task 2: Preserve FK column order and implement encrypted row traversal

**Files:**

- Modify: apps/sql-worker/src/schema/introspectSchema.ts
- Modify: apps/sql-worker/src/schema/introspectSchema.test.ts
- Modify: apps/sql-worker/src/explorer/rowReader.ts
- Modify: apps/sql-worker/src/explorer/rowReader.test.ts
- Modify: apps/sql-worker/src/explorer/relatedRowReader.ts
- Modify: apps/sql-worker/src/explorer/relatedRowReader.test.ts
- Modify: packages/contracts/src/databaseExplorer.ts
- Modify: apps/sql-worker/src/security/databaseExplorerBounds.test.ts

**Interfaces:**

- Consumes: ordered encrypted token codec from Task 1 and catalog FK metadata.
- Produces: FK edge arrays paired by catalog ordinality; rowRefs containing encrypted stable-key plus allowed source FK values; readRelatedRows resolves named edges from either endpoint and uses ordered bound values.
- A request identifies the relation that owns the selected source row; the worker never infers values from browser cell text.

- [ ] **Step 1: Add failing composite-FK and direction tests**

Build a composite FK (tenant_id, student_id) referencing (tenant_id, id) and deliberately shuffle catalog fixture rows. Assert the snapshot preserves pair order. Create a source row whose FK column is not in its pagination key; assert the rowRef can be used for traversal but reveals neither source value in its token text. Test child-to-parent and parent-to-child mapping, missing/null source keys, unknown constraint/source, wrong target, and checksum mismatch. Assert rejected requests issue no relation SELECT.

- [ ] **Step 2: Run worker tests and verify RED**

Run: npx vitest run apps/sql-worker/src/schema/introspectSchema.test.ts apps/sql-worker/src/explorer/rowReader.test.ts apps/sql-worker/src/explorer/relatedRowReader.test.ts

Expected: FAIL because constraint arrays are sorted independently and rowRefs contain pagination keys only.

- [ ] **Step 3: Implement ordered catalog and source-key mapping**

Use WITH ORDINALITY for FK and index attributes, preserving semantic order rather than alphabetical sorting. Build rowRef keys from the pagination key plus the union of allowed source FK columns for the selected row. Never select or encode blocked values. Decode the rowRef using Task 1 confidentiality/context checks, resolve source endpoint and edge from the same checksum, map paired source/target columns by index, and create parameterized equality predicates. Keep the ordinary 25/50/100 row bounds and read-only transaction.

- [ ] **Step 4: Run worker tests and verify GREEN**

Run: npx vitest run apps/sql-worker/src/schema/introspectSchema.test.ts apps/sql-worker/src/explorer/rowReader.test.ts apps/sql-worker/src/explorer/relatedRowReader.test.ts apps/sql-worker/src/security/databaseExplorerBounds.test.ts

Expected: PASS for composite column pairing, both traversal directions, token confidentiality, and rejection before query execution.

- [ ] **Step 5: Commit**

~~~bash
git add apps/sql-worker/src/schema/introspectSchema.ts apps/sql-worker/src/schema/introspectSchema.test.ts apps/sql-worker/src/explorer/rowReader.ts apps/sql-worker/src/explorer/rowReader.test.ts apps/sql-worker/src/explorer/relatedRowReader.ts apps/sql-worker/src/explorer/relatedRowReader.test.ts packages/contracts/src/databaseExplorer.ts apps/sql-worker/src/security/databaseExplorerBounds.test.ts
git commit -m "fix(database): preserve FK traversal values"
~~~

**Acceptance:** Composite relationships retain ordered pairs; rowRefs keep required allowed FK values encrypted; traversal succeeds from parent or child without raw cell-derived filters.

### Task 3: Wire production worker readers and expose target health

**Files:**

- Modify: packages/contracts/src/workerProtocol.ts
- Create: packages/contracts/src/databaseExplorerSchemas.ts
- Modify: apps/sql-worker/src/protocol/authenticateCommand.ts
- Modify: apps/sql-worker/src/protocol/authenticateCommand.test.ts
- Modify: apps/sql-worker/src/runtime/commandHandler.ts
- Modify: apps/sql-worker/src/runtime/commandHandler.test.ts
- Modify: apps/sql-worker/src/runtime/main.ts
- Modify: apps/sql-worker/src/runtime/main.test.ts
- Modify: apps/sql-worker/src/database/targetRegistry.ts
- Modify: apps/sql-worker/src/database/targetRegistry.test.ts

**Interfaces:**

- Consumes: production pools, target registry, schemaReader, readDatabaseRows, and readRelatedRows from Tasks 1–2.
- Produces: database.targets, database.schema, database.rows, and database.relatedRows worker commands. database.targets returns only the closed target set with available/disabled/unavailable state.
- Shared Zod command/result schemas validate runtime payloads and outputs; every available target has a separate verify-full, read-only pool with max two.

- [ ] **Step 1: Add failing production-runtime and Zod-boundary tests**

Extend main.test.ts to send signed commands through the real Unix-socket protocol with fixture catalog and row results. Assert database.schema contains the live fixture table, database.rows returns its row and masked PII cell, and database.relatedRows calls the real traversal reader. Assert the other target pool is untouched. Test disabled target, one unavailable target with the other healthy, malformed payload, malformed reader output, viewer row denial before reader call, and target IDs outside the closed set. No test should assert only that a stub was called.

- [ ] **Step 2: Run worker tests and verify RED**

Run: npx vitest run apps/sql-worker/src/runtime/main.test.ts apps/sql-worker/src/runtime/commandHandler.test.ts apps/sql-worker/src/database/targetRegistry.test.ts apps/sql-worker/src/protocol/authenticateCommand.test.ts

Expected: FAIL because main.ts wires empty schema/row handlers and there is no database.targets worker command.

- [ ] **Step 3: Implement runtime readers, status command, and schemas**

Create schema-reader closures per available registry target after URL TLS and current_user/current_database identity checks. Dispatch each command to the matching target and real reader. Never substitute one target for another. Return registry summaries for database.targets without revealing credentials. Validate target, command payload, and worker result with strict Zod schemas. Allow authenticated viewers to ask for targets/schema but reject rows and relatedRows before touching a pool.

On partial startup or shutdown, close each created pool exactly once. Preserve existing SQL console/mutation commands and flags unchanged.

- [ ] **Step 4: Run worker tests and verify GREEN**

Run: npx vitest run apps/sql-worker/src/runtime apps/sql-worker/src/database/targetRegistry.test.ts apps/sql-worker/src/protocol/authenticateCommand.test.ts apps/sql-worker/src/explorer

Expected: PASS with real reader results, target-specific health, runtime Zod rejection, role checks, and pool isolation.

- [ ] **Step 5: Commit**

~~~bash
git add packages/contracts/src/workerProtocol.ts packages/contracts/src/databaseExplorerSchemas.ts apps/sql-worker/src/protocol/authenticateCommand.ts apps/sql-worker/src/protocol/authenticateCommand.test.ts apps/sql-worker/src/runtime apps/sql-worker/src/database/targetRegistry.ts apps/sql-worker/src/database/targetRegistry.test.ts
git commit -m "fix(database): wire worker readers and target health"
~~~

**Acceptance:** Production no longer returns empty placeholders; worker status reflects flags and health; all worker inputs/results are schema-validated; no fallback crosses target boundaries.

### Task 4: Fix production API parsing, server-bound PII, and fail-closed audit

**Files:**

- Modify: apps/api/src/index.ts
- Modify: apps/api/src/index.test.ts
- Modify: apps/api/src/modules/auth/stepUpService.ts
- Modify: apps/api/src/modules/auth/stepUpService.test.ts
- Modify: apps/api/src/modules/auth/postgresStepUpRepository.ts
- Modify: apps/api/src/modules/auth/postgresStepUpRepository.test.ts
- Modify: packages/db/src/schema/auth.ts
- Modify: packages/db/migrations/0022_database_pii_reveal.sql
- Modify: apps/api/src/modules/database/databaseSchemas.ts
- Modify: apps/api/src/modules/database/databaseExplorerService.ts
- Modify: apps/api/src/modules/database/databaseExplorerService.test.ts
- Modify: apps/api/src/modules/database/databaseRoutes.ts
- Modify: apps/api/src/modules/database/databaseRoutes.test.ts
- Modify: apps/api/src/modules/database/databaseAudit.integration.test.ts
- Modify: apps/api/src/runtime/createOpsApiRuntime.ts
- Modify: apps/api/src/runtime/createOpsApiRuntime.test.ts

**Interfaces:**

- Consumes: database.targets and strict shared worker schemas from Task 3; session principal plus IP/user-agent hashes.
- Produces: production express.json({ limit: '64kb', strict: true }); Zod validation of every worker target/schema/rows/relatedRows response; target summaries from worker registry rather than hard-coded available.
- PII response is exactly { expiresAt }. Server-side lookup binds capability to user, session, IP hash, user-agent hash, and target digest. DELETE /api/v1/database/pii-reveal revokes the authenticated binding without a grant header or target path.
- Every schema/row audit entry records structural checksum where applicable. Worker or audit/revoke failure returns a stable failure and never returns data/reveal success.

- [ ] **Step 1: Add failing API/parser/reveal/audit tests**

Call createOpsApi directly without a test-installed express.json parser; POST valid JSON and assert the service receives it. Test malformed JSON and a body above 64 KiB, no worker call, and stable errors. Return invalid worker target/schema/row/relation objects and assert 503 with no body leakage. Assert GET targets mirrors available, disabled, and unavailable worker states.

For PII, test that a reusable grant authorizes only when user, session, IP hash, user-agent hash, and target all match. Assert reveal response has exactly the expiresAt property, row/relation calls never read X-Ops-Step-Up-Grant, DELETE /pii-reveal requires no grant ID, and expired/revoked/wrong-binding requests fail before worker dispatch. Force grant audit, row audit, revoke, and revoke-audit failures; assert none returns success or row bytes. Assert rows_viewed and pii_rows_viewed metadata includes schemaChecksum without values, cursor, rowRef, or SQL.

- [ ] **Step 2: Run API tests and verify RED**

Run: npx vitest run apps/api/src/index.test.ts apps/api/src/modules/auth/stepUpService.test.ts apps/api/src/modules/auth/postgresStepUpRepository.test.ts apps/api/src/modules/database apps/api/src/runtime/createOpsApiRuntime.test.ts

Expected: FAIL because production has no JSON body parser, targets are hard-coded available, grantId is returned/required in a header, and revoke/audit failures are swallowed.

- [ ] **Step 3: Implement parser, worker validation, and live target projection**

Install bounded strict JSON parsing before API routers. Validate targets, schema snapshots, row results, and related-row results before audit or response; invalid worker results become WORKER_DATABASE_RESPONSE_INVALID without details. Source target state from database.targets. Keep Cache-Control: no-store on schema, rows, relations, and reveal routes. Add schemaChecksum to row and PII audit records.

- [ ] **Step 4: Implement server-side grant resolution and fail-closed revoke**

Add repository/service operations to find or revoke active reusable database_pii grants by capability + user/session/IP hash/user-agent hash + target subject digest. Derive target digest on the server. Do not store password/TOTP and do not expose grant ID. POST reveal returns { expiresAt }; move revoke to DELETE /api/v1/database/pii-reveal. Resolve the current grant for each revealed page before contacting the worker.

If grant audit fails, revoke the just-created grant and return failure. If revoke or audit fails, do not claim success. If any row audit append fails, discard worker rows and return failure. Revoke database_pii grants during logout/session teardown; expired sessions cannot access revealed rows.

- [ ] **Step 5: Run API/auth tests and verify GREEN**

Run: npx vitest run apps/api/src/index.test.ts apps/api/src/modules/auth apps/api/src/modules/database apps/api/src/runtime/createOpsApiRuntime.test.ts packages/db/src/schema

Expected: PASS for production JSON parsing, strict worker validation, live target health, expiry-only reveal response, binding checks, and fail-closed row/revoke/audit paths.

- [ ] **Step 6: Commit**

~~~bash
git add apps/api/src/index.ts apps/api/src/index.test.ts apps/api/src/modules/auth apps/api/src/modules/database apps/api/src/runtime/createOpsApiRuntime.ts apps/api/src/runtime/createOpsApiRuntime.test.ts packages/db/src/schema/auth.ts packages/db/migrations/0022_database_pii_reveal.sql
git commit -m "fix(database): enforce API reveal and audit contract"
~~~

**Acceptance:** Production accepts structured row requests; worker data is validated; availability is real; grant IDs never cross HTTP; bindings and audit/revoke fail closed; audit includes schema checksum.

### Task 5: Complete browser privacy lifecycle, FK direction/paging, and accessibility

**Files:**

- Modify: apps/web/src/web/features/database/databaseApi.ts
- Modify: apps/web/src/web/features/database/databaseApi.test.ts
- Modify: apps/web/src/web/features/database/useDatabaseExplorer.ts
- Modify: apps/web/src/web/features/database/useDatabaseExplorer.test.tsx
- Modify: apps/web/src/web/features/database/PiiRevealDialog.tsx
- Modify: apps/web/src/web/features/database/PiiRevealDialog.test.tsx
- Modify: apps/web/src/web/features/database/DataGrid.tsx
- Modify: apps/web/src/web/features/database/DataGrid.test.tsx
- Modify: apps/web/src/web/features/database/RelatedRowsDrawer.tsx
- Modify: apps/web/src/web/features/database/RelatedRowsDrawer.test.tsx
- Modify: apps/web/src/web/pages/DatabasePage.tsx
- Modify: apps/web/src/web/pages/DatabasePage.test.tsx
- Modify: apps/web/src/web/styles.css

**Interfaces:**

- Consumes: expiry-only reveal and global revoke endpoints from Task 4; source-relation FK request contract and encrypted rowRefs from Task 2.
- Produces: clearRowsAndSensitiveLayers() transition used by hide, expiry, and target switch; API requests carry no grant ID; selected source schema/relation is sent for both FK directions.
- RelatedRowsDrawer owns an independent cursor stack with working next/previous actions. Controls and tables expose accessible names, focus behavior, loading/error announcements, and keyboard operation.

- [ ] **Step 1: Add failing state, race, FK, and accessibility tests**

Use a deferred revealed-row promise; start it, hide/switch, then resolve it with a sentinel PII value. Assert rows, related drawer, selected cell, and DOM remain clear. Assert sequence is clear -> DELETE /pii-reveal -> masked reload; failed revoke keeps state empty and reports an error. Expiry follows the same sequence. Assert the API client has no grant header or grantId state.

For FK tests, select a parent endpoint and assert the request sends that selected schema/relation, not always edge.from. Test composite edges, drawer next with returned cursor, previous restoring the prior cursor, close/source switch reset, and no cursor reuse after target/checksum change. Add keyboard/focus tests for opening/closing the drawer, semantic table headers, button names, sort state, and accessible loading/error/empty messages.

- [ ] **Step 2: Run UI tests and verify RED**

Run: npx vitest run apps/web/src/web/features/database apps/web/src/web/pages/DatabasePage.test.tsx

Expected: FAIL because target switch does not revoke, hide leaves related/selected-cell state, FK requests always use edge.from, and drawer pagination handlers are no-ops.

- [ ] **Step 3: Implement clear-before-revoke and race protection**

Synchronously clear main rows, relatedRowsDrawer, selectedCell, cursor stacks, and active reveal display before issuing DELETE. On successful revoke, reload masked rows or load the new target schema. On failure, keep data empty/masked and do not reload. Use generation tokens/abort handling so an earlier revealed response cannot repopulate cleared state. On countdown expiry, invoke the same transition.

- [ ] **Step 4: Implement correct FK source and drawer-owned pagination**

Send selected source relation/schema, constraint, encrypted rowRef, page size, and drawer cursor to relatedRows. Add drawer-specific load/next/previous actions, use the returned nextCursor, and reset state when source/edge changes or drawer closes. Do not derive filter values from displayed cell text.

Preserve accessible semantic tables and labels. Add keyboard-accessible actions, focus return on close, aria-sort on sortable headers, and announced loading/error/empty state. Keep blocked and masked values non-copyable and never inject HTML.

- [ ] **Step 5: Run UI tests and verify GREEN**

Run: npx vitest run apps/web/src/web/features/database apps/web/src/web/pages/DatabasePage.test.tsx

Expected: PASS for privacy clear ordering, delayed-response rejection, expiry, both FK directions, related pagination, and accessibility behaviors.

- [ ] **Step 6: Commit**

~~~bash
git add apps/web/src/web/features/database/databaseApi.ts apps/web/src/web/features/database/databaseApi.test.ts apps/web/src/web/features/database/useDatabaseExplorer.ts apps/web/src/web/features/database/useDatabaseExplorer.test.tsx apps/web/src/web/features/database/PiiRevealDialog.tsx apps/web/src/web/features/database/PiiRevealDialog.test.tsx apps/web/src/web/features/database/DataGrid.tsx apps/web/src/web/features/database/DataGrid.test.tsx apps/web/src/web/features/database/RelatedRowsDrawer.tsx apps/web/src/web/features/database/RelatedRowsDrawer.test.tsx apps/web/src/web/pages/DatabasePage.tsx apps/web/src/web/pages/DatabasePage.test.tsx apps/web/src/web/styles.css
git commit -m "fix(database): reset privacy and FK browser state"
~~~

**Acceptance:** Reveal expires and is revoked without a client grant ID; old requests cannot restore values; both FK directions and relation pagination work; accessible controls preserve the read-only experience.

### Task 6: Repair role provisioning, command-line renderers, and default-off deployment

**Files:**

- Modify: deploy/postgres/003_database_explorer_roles.sql
- Modify: deploy/postgres/apply-role-grants.sh
- Modify: deploy/postgres/render-database-explorer-grants.ts
- Modify: deploy/postgres/render-database-explorer-grants.test.ts
- Modify: deploy/postgres/verify-database-explorer-role.ts
- Modify: deploy/postgres/verify-database-explorer-role.test.ts
- Modify: scripts/database-explorer/render-policy-report.mjs
- Modify: scripts/database-explorer/render-policy-report.test.ts
- Modify: deploy/ops/env/api.env.example
- Modify: deploy/ops/env/sql-worker.env.example
- Modify: deploy/ops/env/sql-worker.env.example.test.ts
- Modify: deploy/ops/systemd/edutrack-ops-sql-worker.service
- Create: deploy/ops/systemd/edutrack-ops-sql-worker-database-explorer.conf.template
- Modify: deploy/ops/scripts/install-systemd-assets.sh
- Modify: deploy/ops/systemd/systemd-assets.test.ts
- Modify: docs/runbooks/database-explorer-rollout.md
- Modify: docs/runbooks/sql-role-rotation.md

**Interfaces:**

- Consumes: closed target IDs, reviewed structural snapshots/checksums, shared policy, and FileSecretResolver credential references.
- Produces: NOLOGIN capability group ops_database_browser and distinct LOGIN identities ops_browser_edutrack and ops_browser_ops; worker expected-role env names the LOGIN identity.
- Grant renderer is an executable CLI requiring snapshot, approval, target, role, and output paths; it revokes old direct table grants before emitting current safe column grants.
- Base systemd service and env examples remain default-off and require no optional explorer credential files until an explicit opt-in drop-in is installed.

- [ ] **Step 1: Add failing deployment and runbook tests**

Test that runtime example roles name LOGIN roles, never the NOLOGIN capability group. Spawn render-database-explorer-grants.ts with a valid structural snapshot and checksum approval; assert it exits zero and writes SQL. Missing args, invalid target, row values, or checksum mismatch must exit nonzero without sample data. Render a second snapshot with an old safe column now blocked and assert generated SQL revokes stale table grants before regranting approved columns.

Test policy-report execution with a supplied structural snapshot file and reject empty input/rows/cells/rowRefs without echoing sample values. Assert the base service lacks explorer LoadCredential entries, the opt-in drop-in carries them, and every API/worker/target flag defaults false. Assert the runbook provides a non-empty authenticated schema-snapshot input, both API and worker gates, correct login identities, and the working CLI invocation.

- [ ] **Step 2: Run deployment tests and verify RED**

Run: npx vitest run deploy/postgres/render-database-explorer-grants.test.ts deploy/postgres/verify-database-explorer-role.test.ts scripts/database-explorer/render-policy-report.test.ts deploy/ops/env/sql-worker.env.example.test.ts deploy/ops/systemd/systemd-assets.test.ts

Expected: FAIL because the TS renderer is function-only, old grants are not revoked, policy report commands supply empty stdin, and systemd always loads optional credentials.

- [ ] **Step 3: Correct group/login role provisioning and grant revocation**

Keep ops_database_browser as NOLOGIN capability only. Create separate LOGIN roles ops_browser_edutrack and ops_browser_ops, inherit the capability without SET ROLE, limit each to two connections, enforce default_transaction_read_only=on, and forbid elevated privileges. Set OPS_DATABASE_EDUTRACK_ROLE and OPS_DATABASE_OPS_ROLE to those login names. Grant only reviewed column privileges to the capability group.

The renderer transaction first revokes all direct table privileges for ops_database_browser in each included application schema, then grants schema usage and SELECT only for approved, non-blocked columns. It grants no sequence/function privileges. The verifier confirms exact LOGIN/database identity, TLS, no elevation, blocked-column rejection, and mutation rejection.

- [ ] **Step 4: Make policy and grants commands executable**

Add strict CLI argument parsing/main to render-database-explorer-grants.ts, validate the closed target and approved checksum before writing, and test it with spawnSync. Add --snapshot-file to render-policy-report.mjs while retaining stdin mode; it emits only structural names/classification/checksum.

Update the runbook to save the authenticated GET /api/v1/database/:targetId/schema response as structural JSON, pass that file to the report CLI, review it, then invoke the grant renderer with the matching approval file. Never use empty stdin or render without checksum approval.

- [ ] **Step 5: Make explorer systemd credentials opt-in**

Keep OPS_SQL_WORKER_ENABLED=false in api.env.example and OPS_DATABASE_EXPLORER_ENABLED=false plus both target flags false in sql-worker.env.example. Remove target URL, cursor-key, and approval LoadCredential entries from the base worker service; add them to the explicit opt-in drop-in and install it only after those credential files exist. Document the same cursor-key rotation from Task 1 and rollback by turning the affected gates false.

- [ ] **Step 6: Run deployment tests and verify GREEN**

Run: npx vitest run deploy/postgres scripts/database-explorer deploy/ops/env/sql-worker.env.example.test.ts deploy/ops/systemd/systemd-assets.test.ts

Expected: PASS for executable commands, stale grant revocation, login identity, non-empty policy input, and a dark install that does not require explorer credentials.

- [ ] **Step 7: Commit**

~~~bash
git add deploy/postgres scripts/database-explorer deploy/ops/env/api.env.example deploy/ops/env/sql-worker.env.example deploy/ops/env/sql-worker.env.example.test.ts deploy/ops/systemd deploy/ops/scripts/install-systemd-assets.sh docs/runbooks/database-explorer-rollout.md docs/runbooks/sql-role-rotation.md
git commit -m "fix(database): repair explorer provisioning gates"
~~~

**Acceptance:** The example runtime identity can log in, prior direct grants are removed before new grants, report/renderer commands execute with explicit approved inputs, and disabled service startup does not depend on optional credentials.

### Task 7: Prove role enforcement and SQL bounds on ephemeral PostgreSQL

**Files:**

- Create: deploy/postgres/database-explorer-test.compose.yaml
- Create: deploy/postgres/database-explorer-test-init.sql
- Create: scripts/database-explorer/run-postgres-integration.sh
- Create: vitest.database-explorer.integration.config.ts
- Create: apps/sql-worker/src/security/databaseExplorerPostgres.integration.test.ts
- Modify: apps/sql-worker/src/security/databaseExplorerBypass.test.ts
- Modify: apps/sql-worker/src/security/databaseExplorerBounds.test.ts
- Modify: deploy/postgres/verify-database-explorer-role.test.ts
- Modify: package.json

**Interfaces:**

- Consumes: actual PostgreSQL LOGIN roles, verifier, and worker query paths from Tasks 1–6.
- Produces: explicit npm run test:database-explorer:postgres gate using an isolated PostgreSQL 16 fixture. Integration tests are excluded from default unit discovery; invoking this gate without prerequisites exits nonzero and never skips.

- [ ] **Step 1: Remove fake security evidence and add a failing live suite**

Remove expect(true) and regex-only “mutation denied” claims from databaseExplorerBypass.test.ts. Keep useful mocks labeled as unit tests, not evidence of PostgreSQL enforcement. Use a fixture relation with safe_value, pii_email, nullable_sort, tenant_id, student_id, and blocked_token plus a composite FK.

Add live tests using actual LOGIN roles and independent target databases: safe SELECT succeeds; SELECT blocked_token fails at PostgreSQL; INSERT/UPDATE/DELETE/TRUNCATE/CREATE TEMP/CREATE FUNCTION/COPY PROGRAM/SET ROLE are denied; read-only setting, TLS, current_user/current_database, and pool limits are correct. Read duplicate/null keyset pages and compare exact rows; exercise five/six filter boundary, response/cell bounds, timeout rollback, target isolation, and schema drift. No mock object can satisfy these assertions.

- [ ] **Step 2: Run the live gate and verify RED**

Run: npm run test:database-explorer:postgres

Expected: FAIL against current worker/role artifacts or a missing prerequisite, with the prerequisite named; never skip and never report pass when PostgreSQL is unavailable.

- [ ] **Step 3: Build the ephemeral TLS fixture**

Use a Compose project name unique to each run with no persistent named volume. Generate a temporary CA and server certificate with a DNS SAN matching the PostgreSQL service name; connect with sslmode=verify-full and that CA. Create separate edutrack_production and edutrack_ops databases, safe/PII/blocked fixtures, capability group, and distinct LOGIN roles. Store URLs/passwords only in mode-0600 temp files, not shell arguments or logs. The runner checks Docker/Compose, opens ports, certificates, and DB readiness before starting Vitest, and tears down only its own ephemeral project in a finally/trap path.

- [ ] **Step 4: Run the live suite and verify GREEN**

Run: npm run test:database-explorer:postgres

Expected: PASS only when actual PostgreSQL rejects blocked reads and all writes and worker pagination/bounds match the fixture. Missing Docker, certificates, credentials, or databases is a hard failure.

- [ ] **Step 5: Commit**

~~~bash
git add deploy/postgres/database-explorer-test.compose.yaml deploy/postgres/database-explorer-test-init.sql scripts/database-explorer/run-postgres-integration.sh vitest.database-explorer.integration.config.ts apps/sql-worker/src/security/databaseExplorerPostgres.integration.test.ts apps/sql-worker/src/security/databaseExplorerBypass.test.ts apps/sql-worker/src/security/databaseExplorerBounds.test.ts deploy/postgres/verify-database-explorer-role.test.ts package.json
git commit -m "test(database): enforce explorer rules in postgres"
~~~

**Acceptance:** Database-level bypass and bounds claims are backed by the actual target-style PostgreSQL login roles. Unit mocks remain useful but do not count toward this gate.

### Task 8: Exercise the real application stack and separate local from external gates

**Files:**

- Modify: apps/web/playwright.config.ts
- Modify: apps/web/e2e/database-explorer.spec.ts
- Create: apps/web/e2e/database-explorer-stack.mjs
- Create: apps/web/e2e/database-explorer-stack.test.ts
- Modify: apps/web/e2e/fixture-server.mjs
- Modify: apps/web/package.json
- Modify: package.json
- Modify: docs/runbooks/database-explorer-rollout.md
- Modify: deploy/ops/release-assets.test.ts

**Interfaces:**

- Consumes: ephemeral PostgreSQL fixture and enabled-for-test API, private worker socket, and web app from Tasks 1–7.
- Produces: a local Playwright stack with real API + worker + web + both PostgreSQL targets; missing prerequisites fail, and no SQLite fixture or test.skip can count as E2E evidence.
- The local code/test gate is separate from the external two-window production observation gate.

- [ ] **Step 1: Add failing stack and browser assertions**

Require the local stack, owner and viewer fixture accounts, database targets, and each service health check. Remove credential-conditional test.skip calls. Browser tests assert both target schemas and seeded non-empty rows, capture real row/reveal/related API responses, verify PII masked before MFA/reason and visible after valid reveal, prove blocked_token never appears in response/DOM/storage, traverse both FK directions and paginate the drawer, hide/expire/switch/refresh/logout, and assert a viewer never triggers row worker work. Include keyboard/focus and accessible loading/error/empty state checks.

- [ ] **Step 2: Run Playwright and verify RED**

Run: npm run test:e2e --workspace @edutrack-ops/web -- database-explorer.spec.ts

Expected: FAIL because the current Playwright webServer uses a SQLite web fixture and skips tests when owner/viewer credentials are absent.

- [ ] **Step 3: Implement the real isolated test stack**

Replace the Database Explorer test’s SQLite fixture with database-explorer-stack.mjs. Start the ephemeral PostgreSQL fixture; apply Ops API migrations; seed test-only owner/viewer with deterministic test MFA; provision the two browser LOGIN roles; start the worker with two TLS URLs and private Unix socket; start API with OPS_SQL_WORKER_ENABLED=true; start web; wait for every health and target-status check before browser tests. Use temporary mode-0600 fixture credentials, block external network, and clean only this run’s processes/socket/temp resources/Compose project in finally handlers.

- [ ] **Step 4: Run Playwright and verify GREEN**

Run: npm run test:e2e --workspace @edutrack-ops/web -- database-explorer.spec.ts

Expected: PASS with no skipped Database Explorer tests, live API/worker/PostgreSQL traffic, both targets healthy, no external requests, and no blocked value in browser storage, network body, trace, screenshot, or DOM.

- [ ] **Step 5: Write local DoD and separate external rollout gate**

The local code/test gate is typecheck, lint, format check, unit suite, live PostgreSQL integration, build, and this real-stack Playwright suite. Passing it permits deployment review only; it does not enable flags or demonstrate production stability.

Production remains default-off until a named operator provisions/verifies both logins, reviews policy checksums, installs credentials/drop-in, then enables ops for one owner and records at least 24 hours of target-health, timeout, latency, and complete-audit observations. After review, enable edutrack_production for one owner and record a separate 24-hour observation. Enable maintainers only after both records pass review. Each record contains real start/end timestamps and evidence source. Never label either observation PASS from local tests, a release asset, or this plan. Roll back the affected target and, if needed, OPS_DATABASE_EXPLORER_ENABLED and OPS_SQL_WORKER_ENABLED to false, then restart worker/API bridge.

- [ ] **Step 6: Run final local gates and verify GREEN**

Run:

~~~bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:database-explorer:postgres
npm run test:e2e --workspace @edutrack-ops/web -- database-explorer.spec.ts
~~~

Expected: every local command exits zero; committed API, worker, and target gates remain false. No output claims the external 24h + 24h windows passed.

- [ ] **Step 7: Commit**

~~~bash
git add apps/web/playwright.config.ts apps/web/e2e/database-explorer.spec.ts apps/web/e2e/database-explorer-stack.mjs apps/web/e2e/database-explorer-stack.test.ts apps/web/e2e/fixture-server.mjs apps/web/package.json package.json docs/runbooks/database-explorer-rollout.md deploy/ops/release-assets.test.ts
git commit -m "test(database): exercise explorer real stack and gates"
~~~

**Acceptance:** Playwright only passes with API, worker, web, and both PostgreSQL targets live; missing prerequisites fail. Local completion and external rollout evidence are recorded separately and every default remains false.

## Definition of Done

### Local code and test DoD

- All eight tasks are implemented in dependency order, with a focused RED result before the change and GREEN result before that task’s commit.
- typecheck, lint, format check, unit tests, production build, live PostgreSQL integration, and real-stack Playwright pass.
- Runtime readers are wired; tokens are confidential; drift and cursor semantics are correct; FK traversal works both directions; PII binding, worker validation, audit, and no-store behavior match the approved spec.
- Actual PostgreSQL proves blocked-column and mutation enforcement for the browser LOGIN roles.
- Explorer, API bridge, and both targets remain false in committed defaults.

### External staged observation gate

Production rollout is complete only after the separately recorded 24-hour Ops-owner observation, separately recorded 24-hour EduTrack Production-owner observation, and reviewed enablement of maintainer access. Each record contains actual timestamps and health/audit evidence. Local or CI output cannot substitute for these observations or be called production PASS.

## Self-Review and Traceability

- HMAC-readable cursors/rowRefs, 4 KiB/5 minute bounds, context binding, key migration, and no logging: Task 1.
- Schema drift timing, nullable pagination, enum operators, conservative PII patterns: Task 1.
- Composite FK ordinality, source FK rowRef values, both traversal directions: Task 2.
- Production worker stubs, target health/flags, worker Zod boundaries: Task 3.
- Production JSON parsing, server-side PII bindings, expiry-only response, fail-closed audit/revoke, schema checksum: Task 4.
- Clear-before-revoke privacy transitions, target/expiry behavior, reverse FK source, drawer pagination, accessibility: Task 5.
- NOLOGIN group vs LOGIN examples, policy input, executable TS renderer, old grant revocation, OPS_SQL_WORKER_ENABLED, optional systemd credentials: Task 6.
- Fake assertions, regex-only bypass, mock-only bounds, live database-level enforcement: Task 7.
- SQLite/skip removal, API+worker+web E2E, local gate versus external staged observation, default-off: Task 8.
