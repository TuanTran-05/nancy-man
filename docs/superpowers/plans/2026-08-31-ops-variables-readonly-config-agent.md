# Ops Variables Read-Only Config Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a privilege-separated Config Agent and an unlocked, read-only Variables workspace that inventories every allowlisted active VPS configuration definition with its complete value and application/function metadata.

**Architecture:** The canonical Ops API authenticates the browser and calls a versioned, HMAC-authenticated Config Agent over `/run/edutrack-config-agent/agent.sock`. The root-owned agent resolves stable source IDs through a deployed manifest, reads only exact allowlisted files, parses them with consumer-specific adapters, and returns values only for the duration of a session-bound password+TOTP capability. Catalog metadata is versioned in Git; values are never persisted by the API or browser.

**Tech Stack:** Node.js 22.22+, TypeScript 5.8, Express 5, React 19, PostgreSQL, Zod, YAML 2.9.0, Unix domain sockets, systemd credentials/sandboxing, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-ops-variables-access-management-design.md`

**Dependency:** Complete `docs/superpowers/plans/2026-08-31-ops-canonical-auth-user-management.md` first. This plan depends on canonical browser sessions, `StepUpService`, `ops_secret_elevations`, and the routed Ops shell.

## Global Constraints

- Phase 2 is strictly read-only. The agent protocol advertises only `inventory.read`; no draft, save, apply, process-control, or file-write operation is registered.
- Every active `ops_viewer`, `ops_maintainer`, and `ops_owner` can unlock Variables. Existing permissions for unrelated modules do not change.
- Unlock requires the current password and active TOTP. A `variables_secret` capability is server-side, session/IP/user-agent bound, reusable for at most ten minutes, and never exposed as a browser token.
- Full values may cross only the agent socket, the immediate API response, React memory, and the rendered DOM. They must not enter PostgreSQL, audit metadata, logs, traces, metrics, error objects, URLs, service workers, web storage, query caches, or test snapshots.
- The browser leaves `/variables`, locks values, logs out, loses the canonical session, or reaches capability expiry by clearing the inventory state and removing value nodes from the DOM.
- The manifest is root-owned deployment input. Browser/API fields can select only schema-validated stable IDs and variable names; they never select a path, unit, command, URL, or parser.
- The inventory includes only active sources declared by the manifest. Backup copies, arbitrary process environments, OS variables, administrator shell inheritance, and PM2-generated internals are excluded.
- Explicit literal `env` entries in the active PM2 ecosystem are included as `observed`, with duplicate definitions and effective precedence shown separately.
- Fingerprints leaving the agent are HMAC-SHA-256 digests made with an agent-only versioned key. Never emit raw SHA digests of values or source bytes.
- Catalog and coverage artifacts contain names and relationships only. Coverage commands must never read value bytes into report output.
- All source readers reject unmanifested symlinks, unexpected hard links, owner/group/mode drift, oversized files, NUL/unsupported encodings, and manifest version drift before parsing. The sole initial link-aware locator is the manifest-declared EduTrack `current` release alias: it validates the atomic link target is one direct child of the approved releases root, then opens descendants with no-follow semantics.
- Follow TDD: observe the intended failure, implement the minimum passing behavior, run the narrow suite, then the package/repository regression suite before every commit.

---

## File Structure

### Create

- `packages/config-contracts/package.json`
- `packages/config-contracts/tsconfig.json`
- `packages/config-contracts/src/index.ts`
- `packages/config-contracts/src/catalog.ts`
- `packages/config-contracts/src/catalog.test.ts`
- `packages/config-contracts/src/manifest.ts`
- `packages/config-contracts/src/manifest.test.ts`
- `packages/config-contracts/src/agentProtocol.ts`
- `packages/config-contracts/src/agentProtocol.test.ts`
- `packages/config-contracts/src/framing.ts`
- `packages/config-contracts/src/framing.test.ts`
- `config/variables/catalog.yaml`
- `deploy/ops/config-agent/manifest.yaml`
- `scripts/variables/catalogCoverage.ts`
- `scripts/variables/catalogCoverage.test.ts`
- `apps/config-agent/package.json`
- `apps/config-agent/tsconfig.json`
- `apps/config-agent/src/index.ts`
- `apps/config-agent/src/runtimeConfig.ts`
- `apps/config-agent/src/runtimeConfig.test.ts`
- `apps/config-agent/src/manifestLoader.ts`
- `apps/config-agent/src/manifestLoader.test.ts`
- `apps/config-agent/src/security/safeSourceFile.ts`
- `apps/config-agent/src/security/safeSourceFile.test.ts`
- `apps/config-agent/src/adapters/types.ts`
- `apps/config-agent/src/adapters/nodeEnvFile.ts`
- `apps/config-agent/src/adapters/nodeEnvFile.test.ts`
- `apps/config-agent/src/adapters/systemdEnvironmentFile.ts`
- `apps/config-agent/src/adapters/systemdEnvironmentFile.test.ts`
- `apps/config-agent/src/adapters/systemdCredentialFile.ts`
- `apps/config-agent/src/adapters/systemdCredentialFile.test.ts`
- `apps/config-agent/src/adapters/dotenvFile.ts`
- `apps/config-agent/src/adapters/dotenvFile.test.ts`
- `apps/config-agent/src/adapters/pm2EcosystemStatic.ts`
- `apps/config-agent/src/adapters/pm2EcosystemStatic.test.ts`
- `apps/config-agent/src/inventory/fingerprint.ts`
- `apps/config-agent/src/inventory/fingerprint.test.ts`
- `apps/config-agent/src/inventory/inventoryService.ts`
- `apps/config-agent/src/inventory/inventoryService.test.ts`
- `apps/config-agent/src/protocol/authenticatedServer.ts`
- `apps/config-agent/src/protocol/authenticatedServer.test.ts`
- `apps/api/src/infrastructure/configAgentClient.ts`
- `apps/api/src/infrastructure/configAgentClient.test.ts`
- `apps/api/src/modules/variables/variablesService.ts`
- `apps/api/src/modules/variables/variablesService.test.ts`
- `apps/api/src/modules/variables/variablesRoutes.ts`
- `apps/api/src/modules/variables/variablesRoutes.test.ts`
- `apps/web/src/web/pages/VariablesPage.tsx`
- `apps/web/src/web/pages/VariablesPage.test.tsx`
- `apps/web/src/web/components/VariablesUnlock.tsx`
- `apps/web/src/web/components/VariablesUnlock.test.tsx`
- `apps/web/src/web/components/VariableRow.tsx`
- `apps/web/src/web/components/VariableRow.test.tsx`
- `apps/web/e2e/variables-readonly.spec.ts`
- `deploy/ops/systemd/ops-config-agent.service`
- `deploy/ops/systemd/ops-config-agent.tmpfiles.conf`
- `deploy/ops/env/config-agent.env.example`
- `docs/runbooks/ops-config-agent-readonly.md`

### Modify

- `package.json`
- `package-lock.json`
- `tsconfig.base.json`
- `apps/api/src/runtime/runtimeConfig.ts`
- `apps/api/src/runtime/runtimeConfig.test.ts`
- `apps/api/src/runtime/createOpsApiRuntime.ts`
- `apps/api/src/index.ts`
- `packages/security/src/sessions.ts`
- `packages/security/src/sessions.test.ts`
- `apps/web/src/web/App.tsx`
- `apps/web/src/web/api.ts`
- `apps/web/src/web/routing.ts`
- `apps/web/src/web/styles.css`
- `deploy/ops/scripts/install-systemd-assets.sh`
- `deploy/ops/scripts/deploy-release.sh`
- `deploy/ops/systemd-assets.test.ts`
- `docs/runbooks/ops-release.md`

---

## Task 1: Add the Value-Free Catalog, Manifest, and Agent Protocol Contracts

**Files:**

- Create all `packages/config-contracts/*` files listed above.
- Modify `package.json`, `package-lock.json`, and `tsconfig.base.json`.

- [ ] **Step 1: Write failing schema and framing tests**

Cover these invariants with table-driven Vitest cases:

```ts
expect(CatalogSchema.parse(validCatalog).entries[0]).toMatchObject({
  id: 'edutrack.database_url',
  requirement: 'required',
  mutability: 'managed',
  applyStrategy: 'runtime_restart',
});
expect(() => CatalogSchema.parse(catalogContainingValueField)).toThrow();
expect(() => AgentRequestSchema.parse({ version: 1, operation: 'shell.exec' })).toThrow();
expect(decodeFrames(Buffer.concat([encodeFrame(request), encodeFrame(request)]))).toEqual([
  request,
  request,
]);
```

Test strict rejection of unknown fields, unsupported protocol versions, invalid IDs/names, negative limits, duplicate IDs, a frame larger than `1_048_576` bytes, truncated headers, and declared-length mismatch.

Run: `npx vitest run packages/config-contracts/src`

Expected: fail because the workspace and schemas do not exist.

- [ ] **Step 2: Create the workspace and strict contracts**

Add exact `yaml@2.9.0`. Export Zod schemas and inferred types for:

- `Catalog`, `CatalogEntry`, sensitivity, requirement, mutability, category, apply strategy, validator, consumer, and precedence.
- `AgentManifest`, source descriptors, exact owner/group/mode/maximum-byte expectations, catalog digest, source adapter, and fixed action/check IDs.
- `AgentRequestEnvelope` and `AgentResponseEnvelope`, with protocol version `1`, request ID, issued-at/expiry timestamps, actor context, operation, body, and HMAC key ID/signature.
- `inventory.read` request/response and `agent.capabilities` response. Do not add future write bodies yet.
- Inventory definitions with full value, app/function/source metadata, related definition IDs, effective status, source/value HMAC fingerprints, mtime, and optional last Ops change metadata.
- Four-byte unsigned big-endian framing and a streaming decoder with fixed buffer/frame limits.

The request operation must be a discriminated union so an unregistered string cannot reach a dispatcher.

- [ ] **Step 3: Make package tests pass and verify exports**

Run:

```bash
npm install --ignore-scripts
npx vitest run packages/config-contracts/src
npx tsc -p packages/config-contracts/tsconfig.json --noEmit
```

Expected: all pass and the lockfile pins `yaml` to `2.9.0`.

- [ ] **Step 4: Commit the contracts**

```bash
git add package.json package-lock.json tsconfig.base.json packages/config-contracts
git commit -m "feat(config): define read-only agent contracts"
```

---

## Task 2: Build the Initial Catalog, Root-Owned Manifest Input, and Coverage Gate

**Files:**

- Create `config/variables/catalog.yaml`.
- Create `deploy/ops/config-agent/manifest.yaml`.
- Create `scripts/variables/catalogCoverage.ts` and its test.
- Modify `package.json`.

- [ ] **Step 1: Write failing catalog/coverage tests using name-only fixtures**

Construct temporary fixtures containing sentinel values such as `DO_NOT_LEAK_VALUE_7J9K`. Assert the report contains the name but neither the sentinel nor any `NAME=value` serialization.

Test the four report sets:

```ts
expect(report.catalogedActive).toContain('edutrack.database_url');
expect(report.unknownActive).toContain('edutrack.new_vendor_flag');
expect(report.missingRequired).toContain('edutrack.session_secret');
expect(report.staleCatalog).toContain('edutrack.removed_toggle');
```

Also test static references from `process.env.NAME`, `process.env['NAME']`, `import.meta.env.VITE_NAME`, validator allowlists, systemd `EnvironmentFile`/`LoadCredential`, PM2 literal `env`, and scheduled-job launch configuration. Dynamic environment-key construction must produce an explicit manual-review error.

Run: `npx vitest run scripts/variables/catalogCoverage.test.ts`

Expected: fail because the scanner and inputs do not exist.

- [ ] **Step 2: Define exact active source IDs without values**

The checked-in manifest input must declare these initial source mappings:

| Source ID | Exact deployed path | Adapter | Mutability |
|---|---|---|---|
| `edutrack.shared_env` | `/srv/edutrack/shared/.env` | `node_env_file` | catalog-controlled |
| `edutrack.pm2_ecosystem` | verified `current` release alias + `deploy/vps/ecosystem.config.cjs` | `pm2_ecosystem_static` | observed |
| `ops.api_env` | `/etc/edutrack-ops/api.env` | `systemd_environment_file` | catalog-controlled |
| `ops.web_env` | `/etc/edutrack-ops/web.env` | `systemd_environment_file` | catalog-controlled |
| `ops.collector_env` | `/etc/edutrack-ops/collector.env` | `systemd_environment_file` | catalog-controlled |
| `ops.sql_worker_env` | `/etc/edutrack-ops/sql-worker.env` | `systemd_environment_file` | catalog-controlled |
| `ops.credentials` | `/etc/edutrack-ops/credentials` plus explicit child file IDs | `systemd_credential_file` | catalog-controlled |
| `beszel.hub_env` | `/etc/beszel/hub/hub.env` | `dotenv` | catalog-controlled |
| `beszel.agent_env` | `/etc/beszel/agent/agent.env` | `dotenv` | catalog-controlled |

Represent Thien Uy Website as an application with an empty source list and `runtimeVariableCount: 0`. Do not use globs for credential files; enumerate each deployed credential ID with exact path and consumer mapping.

Include expected UID/GID names, octal mode, maximum bytes, adapter ID, path label, app ID, precedence rank, and a `manifestVersion`. For the PM2 source, declare `/srv/edutrack/current` as an `active_release_link`, `/srv/edutrack/releases` as its exact allowed target root, and `deploy/vps/ecosystem.config.cjs` as the fixed descendant. Actual production ownership/mode must be captured by the install preflight and then committed deliberately; no permissive wildcard is allowed.

- [ ] **Step 3: Populate catalog metadata and explicit unknown policy**

Seed catalog entries from active-source names and repository consumer references. Every entry includes description, Vietnamese display labels where used in the UI, app/function category, consumers, sensitivity, requirement, mutability, validator, precedence, apply strategy, and public-build eligibility. No YAML key named `value`, `defaultValue`, `exampleValue`, or `secret` payload is permitted.

PM2 `NODE_ENV`, `HOST`, and `PORT` definitions use `mutability: observed`. Active names without approved metadata appear in `unknownActive` and remain visible/read-only; they are not silently omitted.

- [ ] **Step 4: Implement the value-free coverage CLI**

Expose:

```bash
npm run variables:coverage -- --manifest deploy/ops/config-agent/manifest.yaml \
  --catalog config/variables/catalog.yaml \
  --repo /home/deploy/edutrack-ops \
  --repo /home/deploy/edutrack-platform
```

The production command reads variable **names** from allowlisted active files but never includes associated bytes in its model or report objects. Use parsers that discard values immediately. It exits non-zero for unresolved required references, malformed sources, duplicate catalog IDs, or a discovered active name missing from both cataloged and explicit-unknown output.

- [ ] **Step 5: Run coverage and commit**

Run:

```bash
npx vitest run scripts/variables/catalogCoverage.test.ts packages/config-contracts/src/catalog.test.ts packages/config-contracts/src/manifest.test.ts
npm run variables:coverage -- --manifest deploy/ops/config-agent/manifest.yaml --catalog config/variables/catalog.yaml --repo /home/deploy/edutrack-ops --repo /home/deploy/edutrack-platform
```

Expected: tests pass; the report has four named sets, contains no assignments/values, and every active definition is cataloged or explicitly unknown. Resolve or document each missing required reference as a disabled feature before proceeding.

```bash
git add package.json config/variables deploy/ops/config-agent scripts/variables
git commit -m "feat(config): catalog active VPS variables"
```

---

## Task 3: Implement Read-Only Source Adapters and Filesystem Guards

**Files:**

- Create `apps/config-agent/package.json`, `apps/config-agent/tsconfig.json`, adapter files, `safeSourceFile.ts`, and all associated tests.
- Modify root workspace configuration when required.

- [ ] **Step 1: Write failing hostile-file and parser fixture tests**

For each text adapter, add fixtures for empty values, quoted values, escaped characters, multiline syntax supported by that consumer, comments, CRLF/LF, Unicode, duplicate definitions, malformed lines, oversized input, and NUL bytes. The unchanged round-trip assertion is mandatory even though this phase does not write:

```ts
const parsed = adapter.parse(fixture.bytes);
expect(adapter.serialize(parsed)).toEqual(fixture.bytes);
```

For `pm2_ecosystem_static`, accept only an exported object whose `apps[].env` fields are statically analyzable literals. Reject getters, function calls, spreads from dynamic expressions, computed keys, and any attempt to execute the module.

For `safeSourceFile`, test traversal, unmanifested final/intermediate symlinks, hard-link count greater than one, wrong UID/GID/mode, non-regular files, path replacement between open and stat, and file growth past the manifest limit. Separately test that the declared EduTrack active-release link succeeds only when its target is one direct child of `/srv/edutrack/releases`; reject relative escapes, nested links, link swaps, missing release metadata, and all symlinks below the resolved release directory.

Run: `npx vitest run apps/config-agent/src/adapters apps/config-agent/src/security`

Expected: fail because the agent workspace does not exist.

- [ ] **Step 2: Implement byte-preserving parser models**

Each parsed definition records its byte/token span, name, decoded value, duplicate ordinal, comments/format tokens, and source-specific diagnostics. Serialization reconstructs original bytes when no mutations are present. Do not normalize line endings, quotes, ordering, trailing newline, ownership, or mode.

`systemdCredentialFile` treats manifest-enumerated files as opaque values. Return UTF-8 text only when the catalog declares a text type; otherwise return a base64 display encoding plus explicit encoding metadata. Never guess based on contents.

- [ ] **Step 3: Implement descriptor-relative safe reads**

Open from a trusted root directory descriptor with no-follow semantics, verify every expected component, then compare `fstat` metadata with the manifest after open. Resolve the special `active_release_link` once, validate the target basename/root and release metadata, open the resolved release directory, and use descriptor-relative no-follow access below it; never follow a caller-provided link. Read through the verified descriptor with a hard byte limit. Revalidate inode/device metadata before returning. Map failures to stable codes such as `SOURCE_SYMLINK_REJECTED`, `ACTIVE_RELEASE_CHANGED`, `SOURCE_METADATA_DRIFT`, and `SOURCE_TOO_LARGE`; error messages contain source IDs, not values.

- [ ] **Step 4: Pass adapter and type checks**

Run:

```bash
npx vitest run apps/config-agent/src/adapters apps/config-agent/src/security
npx tsc -p apps/config-agent/tsconfig.json --noEmit
```

Expected: all parser and hostile-filesystem cases pass, including byte-identical unchanged serialization.

- [ ] **Step 5: Commit the read layer**

```bash
git add package.json package-lock.json tsconfig.base.json apps/config-agent
git commit -m "feat(config-agent): safely parse allowlisted sources"
```

---

## Task 4: Build Inventory, Precedence, Fingerprints, and the Authenticated Unix-Socket Server

**Files:**

- Create the remaining `apps/config-agent/src` files listed in File Structure.

- [ ] **Step 1: Write failing inventory tests**

Use temporary sources with duplicate names across EduTrack `.env` and PM2 fixtures. Assert definitions are never collapsed, PM2 literals win only according to the manifest precedence graph, and related definition IDs are symmetric.

Assert cataloged, unknown, and observed records differ correctly:

```ts
expect(byId('edutrack.database_url')).toMatchObject({ requirement: 'required', mutability: 'managed' });
expect(byName('NEW_VENDOR_FLAG')).toMatchObject({ requirement: 'unknown', mutability: 'observed' });
expect(byId('edutrack.pm2_port')).toMatchObject({ mutability: 'observed', effective: true });
```

Prove keyed fingerprints by showing equal low-entropy values under different catalog IDs do not expose the same digest, raw SHA-256 does not match the returned digest, key version is present, and rotation changes output.

- [ ] **Step 2: Write failing protocol authentication tests**

Start the server on a temporary Unix socket. Test valid `agent.capabilities` and `inventory.read`, then reject wrong key ID, bad HMAC, expired/future timestamps, duplicate nonce, reused request ID, unknown field, unsupported operation/version, oversized frame, multiple requests after protocol failure, and non-allowed peer credentials where supported.

Assert log output and serialized errors do not contain fixture values.

Run: `npx vitest run apps/config-agent/src/inventory apps/config-agent/src/protocol`

Expected: fail because the service/server are absent.

- [ ] **Step 3: Implement manifest/catalog loading and drift binding**

Load YAML with strict schemas, calculate a canonical SHA-256 digest of metadata-only catalog bytes, and require it to match the root-owned manifest. Reject duplicate IDs, relative paths, non-canonical paths, unsupported adapters, unknown consumer/precedence references, and a manifest/catalog mismatch before opening any source.

- [ ] **Step 4: Implement the inventory service**

Read sources in a deterministic order, merge catalog metadata without altering values, represent duplicate occurrences independently, calculate effective precedence from declared source/consumer relationships, and calculate agent-only HMAC fingerprints exactly as the spec defines. Do not cache values after the response has been framed and written.

- [ ] **Step 5: Implement authenticated socket dispatch**

Use a systemd-activated or explicitly created Unix socket at `/run/edutrack-config-agent/agent.sock`, mode `0660`, group `edutrack-config-api`. Load the protocol HMAC and fingerprint keys from separate systemd credential files. Keep a bounded expiry cache for nonce/request replay protection. Register only `agent.capabilities` and `inventory.read`; return `AGENT_OPERATION_DISABLED` for every future mutation operation.

- [ ] **Step 6: Verify and commit the agent**

Run:

```bash
npx vitest run apps/config-agent/src
npx tsc -p apps/config-agent/tsconfig.json --noEmit
```

Expected: all tests pass with no sentinel values in captured logs/errors.

```bash
git add apps/config-agent
git commit -m "feat(config-agent): serve authenticated active inventory"
```

---

## Task 5: Add Variables Step-Up and Read-Only Canonical APIs

**Files:**

- Create `apps/api/src/infrastructure/configAgentClient.ts` and test.
- Create `apps/api/src/modules/variables/*` files listed above.
- Modify API runtime/config/index and `packages/security/src/sessions.ts` with tests.

- [ ] **Step 1: Write failing permission and unlock route tests**

Add `variables:read`, `variables:write`, and `variables:apply` permissions to all three active Ops roles for the complete program, but expose only read operations in this phase. Test each role can unlock. Test pending, administratively locked, cooldown-blocked, revoked, invalid-password, invalid-TOTP, missing Origin/CSRF, and rate-limited requests fail without agent access.

`POST /api/v1/auth/variables/unlock` accepts `{ password, totpCode }`, creates a ten-minute reusable `variables_secret` grant whose expiry is capped by the parent session, sets no additional browser credential, and returns only `{ unlockedUntil }` with no-store headers.

`DELETE /api/v1/auth/variables/unlock` revokes the current session's capability idempotently.

Run: `npx vitest run packages/security/src/sessions.test.ts apps/api/src/modules/variables/variablesRoutes.test.ts`

Expected: fail because permissions and routes are absent.

- [ ] **Step 2: Write failing inventory/API-agent tests**

Test the client signs framed requests, enforces connect/read/total timeouts, verifies response HMAC/request ID/version, rejects trailing frames and schema drift, and never includes response bodies in thrown errors.

Test `GET /api/v1/variables/catalog` returns value-free metadata to an authenticated active account, while `GET /api/v1/variables` requires `StepUpService.authorize` for `variables_secret`. Every response containing values must set:

```text
Cache-Control: no-store, private
Pragma: no-cache
Vary: Cookie
```

Assert a database spy sees no values and audit metadata contains actor/session/source IDs, success/failure code, catalog/manifest version, and counts only.

- [ ] **Step 3: Implement the API client and runtime configuration**

Add required configuration for socket path, protocol HMAC credential reference/key ID, connect/read/total timeouts, maximum response bytes, and read-only feature flag. Load the API-side protocol key through systemd credentials. Startup calls `agent.capabilities` and refuses to enable Variables when protocol version, manifest/catalog digest, or `readOnly: true` does not match deployment expectations.

- [ ] **Step 4: Implement service/routes and explicit value redaction**

The service accepts actor context generated by the API, never from request JSON. It calls the agent only after canonical session/permission/capability checks. Map stable agent errors to value-free HTTP responses; do not serialize caught objects or socket buffers. Add a Variables-specific redaction test to the logger so nested fields named `value`, `currentValue`, `credential`, or `agentResponse` cannot be logged.

- [ ] **Step 5: Pass API tests and commit**

Run:

```bash
npx vitest run packages/security/src/sessions.test.ts apps/api/src/infrastructure/configAgentClient.test.ts apps/api/src/modules/variables
npx tsc -p apps/api/tsconfig.json --noEmit
```

Expected: all roles can read only after step-up; capability expiry/revoke blocks the next read; no values reach logs/audit/database spies.

```bash
git add packages/security/src/sessions.ts packages/security/src/sessions.test.ts apps/api/src/infrastructure/configAgentClient.ts apps/api/src/infrastructure/configAgentClient.test.ts apps/api/src/modules/variables apps/api/src/runtime apps/api/src/index.ts
git commit -m "feat(api): expose step-up protected variable inventory"
```

---

## Task 6: Implement the Approved Read-Only Variables Workspace

**Files:**

- Create the web page/components/tests and Playwright test listed above.
- Modify `App.tsx`, `api.ts`, `routing.ts`, and `styles.css`.

- [ ] **Step 1: Write failing unlock and lifecycle component tests**

Render `/variables` with an active canonical session. Assert it starts with the approved password+TOTP gate, uses password and one-time-code autocomplete semantics, and does not request inventory before successful unlock.

Use fake timers to prove full values disappear from React output when:

- the ten-minute deadline arrives;
- the user clicks **Khóa giá trị**;
- the route changes;
- a session request returns `401`;
- the page becomes locked after an unlock/delete request;
- the component unmounts.

Spy on `localStorage`, `sessionStorage`, IndexedDB, query serialization, and error reporting; no inventory value may be written.

- [ ] **Step 2: Write failing inventory presentation tests**

Using synthetic non-production values, assert the workspace:

- renders complete names and values without masking after unlock;
- groups and filters by application and functional category;
- searches names/descriptions without persisting the query;
- shows source path label, consumer/function, sensitivity, requirement, mutability, apply effect, effective precedence, duplicates, and last change metadata;
- marks unknown and observed definitions read-only;
- shows Thien Uy Website with zero runtime variables;
- has no edit/delete/save/apply control in read-only phase;
- clears old results before rendering a refreshed result.

Run: `npx vitest run apps/web/src/web/components/VariablesUnlock.test.tsx apps/web/src/web/components/VariableRow.test.tsx apps/web/src/web/pages/VariablesPage.test.tsx`

Expected: fail because the UI does not exist.

- [ ] **Step 3: Implement in-memory-only API and state handling**

Use direct `fetch` with canonical CSRF handling and `cache: 'no-store'`; do not place inventory responses into shared query caches. Keep the inventory in page-local state, clear the previous array before refresh/unlock errors, and overwrite references on lock/unmount. Treat clearing as a UI-lifetime guarantee, not as JavaScript memory erasure.

After unlock, start a local deadline from the server's `unlockedUntil`. Do not refresh it on focus, polling, or background activity. A `401 STEP_UP_REQUIRED|STEP_UP_EXPIRED` transition synchronously removes the value list before showing the gate.

- [ ] **Step 4: Implement the approved visual hierarchy and route policy**

Translate the approved Superdesign `/variables` surface into existing React/CSS components: Ops shell navigation, locked workspace, application/category filters, definition rows, full value field, metadata, precedence relationship, and a prominent **Khóa giá trị** action. Preserve the existing design tokens and responsive behavior.

Add page-specific CSP response configuration with no third-party scripts and `connect-src 'self'`. Add `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and no-store HTML/API caching for the route.

- [ ] **Step 5: Add end-to-end tests**

In Playwright, cover viewer/maintainer/owner unlock, invalid proof, full display, filters, duplicate precedence, manual lock, route-leave clearing, expiry clearing, and direct API denial without capability. Inspect storage state and recorded requests to prove no values appear in URL/query/referrer/browser storage.

- [ ] **Step 6: Verify and commit the web surface**

Run:

```bash
npx vitest run apps/web/src/web
npx playwright test apps/web/e2e/variables-readonly.spec.ts
npx tsc -p apps/web/tsconfig.json --noEmit
```

Expected: component and end-to-end tests pass; no edit/apply surface exists.

```bash
git add apps/web/src/web apps/web/e2e/variables-readonly.spec.ts
git commit -m "feat(web): add read-only Variables workspace"
```

---

## Task 7: Install the Read-Only Agent with a Hardened systemd Boundary

**Files:**

- Create systemd/env/runbook files listed above.
- Modify deployment scripts, systemd asset tests, and release runbook.

- [ ] **Step 1: Write failing deployment-asset tests**

Extend `deploy/ops/systemd-assets.test.ts` to require:

- dedicated `edutrack-config-agent` user and `edutrack-config-api` socket group;
- API membership in only the socket group, not arbitrary privileged groups;
- socket/runtime directory mode/ownership;
- `NoNewPrivileges`, `PrivateTmp`, `PrivateDevices`, `ProtectSystem=strict`, `ProtectHome=true`, restricted address families, syscall/capability bounding, resource limits, and explicit read-only paths;
- no broad `ReadWritePaths` in read-only phase;
- separate protocol HMAC and fingerprint systemd credentials;
- restart throttling and value-free journald policy;
- ordered startup so API capability negotiation occurs only after the agent socket exists.

Run: `npx vitest run deploy/ops/systemd-assets.test.ts`

Expected: fail because the assets are absent.

- [ ] **Step 2: Add idempotent installation and preflight**

The installer creates the service user/group, installs the binary and manifest atomically, validates catalog digest and exact source metadata, installs credentials with least privilege, and refuses deployment if any active source is a symlink, hard-linked unexpectedly, over the size limit, or has unapproved owner/mode. It must not print file contents on success or failure.

The deployment sequence is: install inactive binary/config → validate → start agent → run signed `agent.capabilities` and test inventory as the API service account → enable API feature flag → restart API → HTTP smoke tests. A failed preflight leaves the previous service/config active.

- [ ] **Step 3: Write the operator runbook**

Document installation, key creation/rotation, manifest/catalog deployment, ownership drift recovery, socket permission checks, capability negotiation, no-value log inspection, disabling the feature flag, and rollback to the previous agent unit/binary. Commands that inspect inventory must print counts/IDs only.

- [ ] **Step 4: Run deployment tests and a disposable socket smoke test**

Run:

```bash
npx vitest run deploy/ops/systemd-assets.test.ts apps/config-agent/src/protocol/authenticatedServer.test.ts apps/api/src/infrastructure/configAgentClient.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
npm run format:check
```

Expected: every command exits `0`. The smoke client, run as the configured API identity in a disposable environment, can call capabilities/inventory and cannot read source files directly.

- [ ] **Step 5: Commit deployment assets**

```bash
git add deploy/ops apps/api/src/runtime docs/runbooks/ops-config-agent-readonly.md
git commit -m "ops(config-agent): install hardened read-only service"
```

---

## Plan Completion Gate

- [ ] Canonical login, session, CSRF, and password+TOTP step-up are required before any value response.
- [ ] Viewer, maintainer, and owner can unlock; inactive accounts cannot.
- [ ] Every allowlisted active definition is cataloged or explicitly unknown; required missing references are resolved or approved as disabled features.
- [ ] Explicit PM2 literal environment entries appear separately and generated PM2 internals do not appear.
- [ ] Full values appear only in the unlocked DOM/API path and never in DB, audit, log, URL, cache, telemetry, test snapshot, or coverage output.
- [ ] Unknown and observed definitions are visibly read-only; no mutation/apply protocol or UI is deployed.
- [ ] HMAC fingerprints use a separate agent-only key and disclose no raw content hashes.
- [ ] Hostile path/metadata/parser/protocol inputs fail closed with stable value-free errors.
- [ ] Manual lock, route leave, logout/session loss, and ten-minute expiry remove values from the DOM.
- [ ] Config Agent has no public listener, socket access is limited to the API, and systemd grants only the read paths required by the manifest.
- [ ] Narrow suites and full `typecheck`, `lint`, `test`, `build`, and `format:check` pass from a clean checkout.
- [ ] A production deployment still requires an explicit operator-approved runbook execution; completing this code plan alone does not modify live VPS configuration.
