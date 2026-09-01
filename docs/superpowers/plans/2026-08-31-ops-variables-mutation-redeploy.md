# Ops Variables Mutation, Apply, Rollback, and Redeploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the approved read-only Variables control plane with guarded edits, optional deletes, encrypted staging/snapshots, deterministic runtime actions, health checks, automatic rollback, application blocking after rollback failure, and clean-SHA configuration-derived rebuilds.

**Architecture:** The browser holds editable values only in page-local memory and sends them through canonical, step-up-protected APIs. PostgreSQL stores a value-free change state machine and audit metadata. The Config Agent validates and encrypts value-bearing drafts, takes encrypted exact-byte snapshots, atomically writes allowlisted sources, runs only manifest-declared actions/checks, and rolls back on every failure. Build-time changes delegate to reviewed release tooling that builds the currently active Git SHA in an isolated worktree and identifies the result with a source SHA plus configuration digest.

**Tech Stack:** Node.js 22.22+, TypeScript 5.8, Express 5, React 19, PostgreSQL advisory locks, Zod, Node crypto AES-256-GCM/HMAC-SHA-256, Unix domain sockets, PM2, systemd, Git worktrees, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-ops-variables-access-management-design.md`

**Dependencies:** Complete both earlier plans in order:

1. `docs/superpowers/plans/2026-08-31-ops-canonical-auth-user-management.md`
2. `docs/superpowers/plans/2026-08-31-ops-variables-readonly-config-agent.md`

## Global Constraints

- Roll out independently behind `OPS_VARIABLES_DRAFT_ENABLED`, `OPS_VARIABLES_RUNTIME_APPLY_ENABLED`, and `OPS_VARIABLES_BUILD_APPLY_ENABLED`. Read-only inventory remains usable when every write flag is off.
- Every active Ops role may draft, edit, delete optional definitions, validate, save, and apply. Account role is not a safety tier for Variables.
- Required definitions are never deletable. Unknown and observed definitions are never editable or deletable. Enforce these rules independently in browser, API catalog validation, and Config Agent validation.
- A change contains one application change group only. Cross-application work uses separate change IDs.
- There is no force overwrite. Every value-bearing request carries the inventory source fingerprint; mismatch returns `409 CONFIG_SOURCE_CHANGED` and requires reload/restage.
- Values may exist only in browser memory, transient API request memory, authenticated agent protocol buffers, and agent-encrypted draft/snapshot files. PostgreSQL, audit, logs, traces, metrics, SSE, URLs, incident payloads, and error responses remain value-free.
- Saved change/apply authorization binds to the agent HMAC `changeDigest`. The `variables_apply` grant requires fresh password+TOTP, lasts at most five minutes, is one-use, and is consumed atomically before apply dispatch whether dispatch/apply succeeds or fails.
- Browser input never provides a filesystem path, service/PM2 name, command, argument vector, health URL, validator executable, build root, or action ID outside the agent-produced impact plan.
- Stage, snapshot, fingerprint, and API-agent protocol keys are separate versioned systemd credentials. Do not derive one from another.
- Atomic writes preserve exact unrelated bytes and original UID/GID/mode. Every write follows sibling-temp write, metadata restore, file `fsync`, rename, directory `fsync`, reopen, reparse, and fingerprint verification.
- Any write, action, timeout, or health failure automatically enters rollback. `ROLLBACK_FAILED` creates a Critical incident, retains evidence, and blocks later applies for that application until an owner clears the block after remediation.
- Clearing an application block uses `POST /api/v1/config-applications/:appId/apply-block/clear`, requires an owner, exact app-ID confirmation, a non-empty value-free remediation summary, resolved Critical incident metadata, and a freshly consumed one-use `accounts_write` password+TOTP grant.
- `APP_COMMIT_SHA` remains exactly the 40-character source Git SHA. Add `APP_RELEASE_ID=<sha>-cfg-<digest>` and `APP_CONFIG_DIGEST=<digest>` instead of overloading source identity.
- A frontend build accepts only catalog entries with `sensitivity: public` and `buildAllowed: true`; a `VITE_` prefix alone never authorizes exposure.
- Use no shell strings. The agent executes only fixed manifest-declared binaries with fixed argument templates through `spawn`/`execFile`, a minimal environment, bounded output, timeout, and killed process group.
- Follow TDD and commit each task only after its narrow tests and relevant regression suite pass.
- Do not enable a production mutation flag until its runbook and corresponding injected-failure drill are complete.

---

## File Structure

### Create in `/home/deploy/edutrack-ops`

- `packages/db/migrations/0016_ops_config_changes.sql`
- `packages/db/src/configChangesMigration.test.ts`
- `packages/config-contracts/src/changeProtocol.ts`
- `packages/config-contracts/src/changeProtocol.test.ts`
- `apps/api/src/modules/variables/changeStateMachine.ts`
- `apps/api/src/modules/variables/changeStateMachine.test.ts`
- `apps/api/src/modules/variables/postgresConfigChangeRepository.ts`
- `apps/api/src/modules/variables/postgresConfigChangeRepository.test.ts`
- `apps/api/src/modules/variables/configChangeService.ts`
- `apps/api/src/modules/variables/configChangeService.test.ts`
- `apps/api/src/modules/variables/configChangeRoutes.ts`
- `apps/api/src/modules/variables/configChangeRoutes.test.ts`
- `apps/api/src/modules/variables/configChangeEvents.ts`
- `apps/api/src/modules/variables/configChangeEvents.test.ts`
- `apps/config-agent/src/crypto/encryptedEnvelope.ts`
- `apps/config-agent/src/crypto/encryptedEnvelope.test.ts`
- `apps/config-agent/src/changes/draftStore.ts`
- `apps/config-agent/src/changes/draftStore.test.ts`
- `apps/config-agent/src/changes/validationService.ts`
- `apps/config-agent/src/changes/validationService.test.ts`
- `apps/config-agent/src/changes/atomicSourceWriter.ts`
- `apps/config-agent/src/changes/atomicSourceWriter.test.ts`
- `apps/config-agent/src/changes/snapshotStore.ts`
- `apps/config-agent/src/changes/snapshotStore.test.ts`
- `apps/config-agent/src/changes/actionRunner.ts`
- `apps/config-agent/src/changes/actionRunner.test.ts`
- `apps/config-agent/src/changes/healthCheckRunner.ts`
- `apps/config-agent/src/changes/healthCheckRunner.test.ts`
- `apps/config-agent/src/changes/applyStateMachine.ts`
- `apps/config-agent/src/changes/applyStateMachine.test.ts`
- `apps/config-agent/src/changes/applyCoordinator.ts`
- `apps/config-agent/src/changes/applyCoordinator.test.ts`
- `apps/config-agent/src/changes/changeRecovery.ts`
- `apps/config-agent/src/changes/changeRecovery.test.ts`
- `apps/config-agent/src/cleanup/retentionService.ts`
- `apps/config-agent/src/cleanup/retentionService.test.ts`
- `apps/web/src/web/components/VariableEditor.tsx`
- `apps/web/src/web/components/VariableEditor.test.tsx`
- `apps/web/src/web/components/StagedChangesPanel.tsx`
- `apps/web/src/web/components/StagedChangesPanel.test.tsx`
- `apps/web/src/web/components/ApplyConfirmation.tsx`
- `apps/web/src/web/components/ApplyConfirmation.test.tsx`
- `apps/web/src/web/components/ApplyProgress.tsx`
- `apps/web/src/web/components/ApplyProgress.test.tsx`
- `apps/web/e2e/variables-mutation.spec.ts`
- `deploy/ops/systemd/ops-config-agent-cleanup.service`
- `deploy/ops/systemd/ops-config-agent-cleanup.timer`
- `docs/runbooks/ops-variables-apply-rollback.md`
- `docs/runbooks/ops-variables-rollback-failed.md`
- `docs/runbooks/ops-config-agent-key-rotation.md`
- `docs/runbooks/ops-variables-build-redeploy.md`

### Modify in `/home/deploy/edutrack-ops`

- `packages/db/src/schema/auth.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/src/migrationManifest.ts`
- `packages/db/src/migrationManifest.test.ts`
- `packages/config-contracts/src/index.ts`
- `packages/config-contracts/src/agentProtocol.ts`
- `config/variables/catalog.yaml`
- `deploy/ops/config-agent/manifest.yaml`
- `apps/api/src/runtime/runtimeConfig.ts`
- `apps/api/src/runtime/runtimeConfig.test.ts`
- `apps/api/src/runtime/createOpsApiRuntime.ts`
- `apps/api/src/index.ts`
- `apps/api/src/modules/variables/variablesRoutes.ts`
- `apps/config-agent/src/protocol/authenticatedServer.ts`
- `apps/config-agent/src/index.ts`
- `apps/config-agent/src/adapters/nodeEnvFile.ts`
- `apps/config-agent/src/adapters/systemdEnvironmentFile.ts`
- `apps/config-agent/src/adapters/systemdCredentialFile.ts`
- `apps/config-agent/src/adapters/dotenvFile.ts`
- `apps/web/src/web/pages/VariablesPage.tsx`
- `apps/web/src/web/pages/VariablesPage.test.tsx`
- `apps/web/src/web/api.ts`
- `apps/web/src/web/styles.css`
- `deploy/ops/systemd/ops-config-agent.service`
- `deploy/ops/env/config-agent.env.example`
- `deploy/ops/systemd-assets.test.ts`
- `deploy/ops/scripts/install-systemd-assets.sh`
- `deploy/ops/scripts/deploy-release.sh`
- `docs/runbooks/ops-release.md`

### Modify in `/home/deploy/edutrack-platform`

- `deploy/vps/prepare-platform-release.sh`
- `deploy/vps/activate-platform-release.sh`
- `deploy/vps/prepare-environment.mjs`
- `deploy/vps/validate-environment.mjs`
- `deploy/vps/ecosystem.config.cjs`
- `deploy/vps/canonical-release-assets.test.ts`
- `deploy/vps/environment-safety.test.ts`
- `deploy/vps/production-source-guard.mjs`
- `scripts/consolidation/releaseArtifact.mjs`
- `scripts/vite-portal-env-boundary.test.ts`
- `scripts/validate-staff-build-env.mjs`
- `scripts/validate-staff-build-env.test.ts`

---

## Task 1: Persist a Value-Free Change State Machine in PostgreSQL

**Files:**

- Create migration, schema test, state machine, repository, and tests listed above.
- Modify database schema/manifest files.

- [ ] **Step 1: Write failing pure state-machine tests**

Encode the exact legal transitions:

```text
DRAFT -> VALIDATING
VALIDATING -> INVALID | READY
READY -> SAVED
SAVED -> APPLYING
APPLYING -> SNAPSHOTTED -> WRITTEN -> ACTION_RUNNING -> HEALTH_CHECKING -> COMPLETED
APPLYING|SNAPSHOTTED|WRITTEN|ACTION_RUNNING|HEALTH_CHECKING -> ROLLING_BACK
ROLLING_BACK -> ROLLED_BACK | ROLLBACK_FAILED
DRAFT|READY|SAVED -> CANCELLED | EXPIRED
```

Assert terminal states, including `INVALID`, reject all new transitions; replaying the same transition/event ID is idempotent; transition sequence numbers are monotonic; and two APPLYING starts for one change cannot succeed. To correct an invalid or already validated change without reversing state, create a new `DRAFT` linked by `supersedesChangeId`; the UI may carry its still-in-memory proposed values into that new draft.

Run: `npx vitest run apps/api/src/modules/variables/changeStateMachine.test.ts`

Expected: fail because the module does not exist.

- [ ] **Step 2: Write failing migration/repository tests**

Migration `0016_ops_config_changes.sql` creates:

- `ops_config_changes`: UUID, optional `supersedes_change_id`, actor/session, application change group, reason, state, HMAC digest, catalog/manifest/key versions, value-free impact JSON, agent envelope ID, expiry, timestamps, monotonic version.
- `ops_config_change_items`: change/source/catalog IDs, operation, requirement, strategy, old/new value fingerprints, observed source fingerprint; no value/text payload column.
- `ops_config_runs`: run/transition ID, state, fixed action/check IDs, value-free result codes/summaries, snapshot reference, rollback result, timestamps.
- `ops_config_application_blocks`: application ID primary key, failed run/change, reason code, blocked/acknowledged/cleared actor and timestamps.

Add CHECK constraints for enums, item operation (`set|delete`), terminal/revoked fields, and non-empty reason. Add one-running-apply-per-application enforcement with advisory locks plus a partial uniqueness constraint where representable. Add foreign keys to canonical users/sessions and append-only audit identifiers.

Repository tests must inspect schema columns and prove a synthetic secret cannot be stored by any repository method/type. Test optimistic version updates, idempotent transition IDs, advisory-lock contention, and application-block checks under concurrent database connections.

- [ ] **Step 3: Implement state machine, migration, repository, and trust-root checksum**

Keep impact JSON schema-validated and limited to app/source/action/check IDs, strategies, counts, warnings, and expected effect. Repository APIs accept branded fingerprint/digest strings and metadata types only. Do not accept generic request objects or unknown JSON.

- [ ] **Step 4: Run DB suites and commit**

Run:

```bash
npx vitest run apps/api/src/modules/variables/changeStateMachine.test.ts apps/api/src/modules/variables/postgresConfigChangeRepository.test.ts packages/db/src/configChangesMigration.test.ts packages/db/src/migrationManifest.test.ts packages/db/src/migrate.test.ts
npx tsc -p apps/api/tsconfig.json --noEmit
```

Expected: migration checksum is pinned and all concurrency/state tests pass.

```bash
git add packages/db apps/api/src/modules/variables/changeStateMachine.ts apps/api/src/modules/variables/changeStateMachine.test.ts apps/api/src/modules/variables/postgresConfigChangeRepository.ts apps/api/src/modules/variables/postgresConfigChangeRepository.test.ts
git commit -m "feat(config): persist value-free change state"
```

---

## Task 2: Extend the Agent Contract for Validation, Save, Apply, Status, and Recovery

**Files:**

- Create/modify `packages/config-contracts/src/changeProtocol.ts`, `agentProtocol.ts`, `index.ts`, and tests.

- [ ] **Step 1: Write failing strict-contract tests**

Add discriminated bodies for `change.validate`, `change.save`, `change.apply`, `change.cancel`, `change.status`, and `application.clearApplyBlock`. Tests reject:

- missing inventory source fingerprints;
- a path/action/command/URL field from caller input;
- mixed `appId` values;
- `delete` without an optional/managed catalog match;
- value on a delete item or absent value on a set item;
- unknown/observed edit metadata;
- duplicate source/catalog occurrence IDs;
- apply without change digest/run ID;
- status/SSE content containing a field named `value`.

Run: `npx vitest run packages/config-contracts/src/changeProtocol.test.ts packages/config-contracts/src/agentProtocol.test.ts`

Expected: fail because mutation messages are not registered.

- [ ] **Step 2: Implement bounded value-bearing request schemas**

Values appear only in the `change.validate` request body and are limited by catalog type plus an absolute protocol limit. `change.validate` supports `replaceDraft: true` so `PUT /config-changes/:id/items` replaces an agent-owned encrypted provisional draft; a later validate call may reuse that draft without retransmitting values. `change.save` seals the validated provisional draft into the 24-hour staged envelope. This preserves the approved public routes without adding browser-selected agent operations.

Responses contain validation rule IDs, item/source fingerprints, change digest, impact plan, state, and value-free warnings only. `change.status` exposes state/events by stable IDs and reason codes.

- [ ] **Step 3: Pass contract tests and commit**

Run:

```bash
npx vitest run packages/config-contracts/src
npx tsc -p packages/config-contracts/tsconfig.json --noEmit
```

```bash
git add packages/config-contracts/src
git commit -m "feat(config): define guarded change protocol"
```

---

## Task 3: Add Key-Separated Encrypted Draft and Snapshot Storage

**Files:**

- Create `encryptedEnvelope.ts`, `draftStore.ts`, `snapshotStore.ts`, `retentionService.ts`, and tests.
- Modify agent runtime config and env example.

- [ ] **Step 1: Write failing cryptographic envelope tests**

Use fixed test keys and deterministic test randomness only through injected dependencies. Assert AES-256-GCM round-trip, random 96-bit nonce uniqueness, authenticated header/AAD binding for envelope type/change/app/catalog/manifest/key version/expiry, tamper rejection for every segment, wrong-purpose/wrong-version key rejection, truncated/corrupt file rejection, and no plaintext sentinel in on-disk bytes.

Prove staging, snapshot, fingerprint, and protocol keys cannot decrypt or authenticate each other's artifacts.

- [ ] **Step 2: Write failing permission/retention tests**

Test `/var/lib/edutrack-config-agent/{drafts,staged,snapshots,locks}` directory mode `0700`, artifact mode `0600`, atomic temp+fsync+rename writes, no-follow reads, exact owner checks, 24-hour draft/staged expiry, 30-day successful snapshot retention, evidence retention override for `ROLLBACK_FAILED`, and cleanup idempotency.

Cleanup events contain IDs/counts only. They never include decrypted metadata or values.

Run: `npx vitest run apps/config-agent/src/crypto apps/config-agent/src/changes/draftStore.test.ts apps/config-agent/src/changes/snapshotStore.test.ts apps/config-agent/src/cleanup`

Expected: fail because stores do not exist.

- [ ] **Step 3: Implement separate credential loading and encrypted stores**

Load each 32-byte key from a distinct systemd credential path with explicit key IDs and accepted old-key lists for rotation. Fail startup on reuse of identical key bytes across purposes. Zero temporary key/buffer references where practical after use; do not claim guaranteed heap erasure.

Use provisional encrypted drafts for `replaceDraft`, sealed staged envelopes for saved changes, and snapshot envelopes for exact source bytes/file metadata/release/process state. Persist a minimal value-free index sufficient for cleanup and recovery.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx vitest run apps/config-agent/src/crypto apps/config-agent/src/changes/draftStore.test.ts apps/config-agent/src/changes/snapshotStore.test.ts apps/config-agent/src/cleanup
npx tsc -p apps/config-agent/tsconfig.json --noEmit
```

```bash
git add apps/config-agent/src/crypto apps/config-agent/src/changes/draftStore.ts apps/config-agent/src/changes/draftStore.test.ts apps/config-agent/src/changes/snapshotStore.ts apps/config-agent/src/changes/snapshotStore.test.ts apps/config-agent/src/cleanup apps/config-agent/src/runtimeConfig.ts apps/config-agent/src/runtimeConfig.test.ts deploy/ops/env/config-agent.env.example
git commit -m "feat(config-agent): encrypt staged changes and snapshots"
```

---

## Task 4: Implement Validation and Byte-Preserving Atomic Writes

**Files:**

- Create validation/writer files and tests.
- Modify write-capable adapters and catalog/manifest validators.

- [ ] **Step 1: Write failing layered validation tests**

Cover all ten layers from the spec: API shape/length/encoding; capability metadata; catalog/source/requirement/mutability/strategy; current fingerprint; parser round-trip; per-variable rule; cross-variable rule; manifest-declared application validator; public-build rule; deterministic impact plan.

Include URL, bounded integer, enum, JSON, non-empty, key/certificate structure, paired credential, mutually required endpoint, and delete-exposes-lower-precedence warning cases. Execute application validators through an injected fixed runner using manifest IDs; tests prove the draft cannot supply executable/args/environment.

External source change at validate time must return `CONFIG_SOURCE_CHANGED` without writing or offering a force option.

- [ ] **Step 2: Write failing atomic-write/failure-injection tests**

For every writable adapter, mutate one selected occurrence and assert comments, order, quote style where compatible, unrelated definitions, line endings, owner/group/mode, and trailing newline are preserved. Required delete, unknown/observed edit, duplicate ambiguity, symlink swap, hard link, metadata drift, stale fingerprint, disk-full short write, failed file `fsync`, failed rename, failed directory `fsync`, and post-write reparse/fingerprint mismatch must fail closed.

For multi-source changes, inject failure after each write position and assert the coordinator requests rollback immediately.

Run: `npx vitest run apps/config-agent/src/changes/validationService.test.ts apps/config-agent/src/changes/atomicSourceWriter.test.ts apps/config-agent/src/adapters`

Expected: fail because write/validation paths do not exist.

- [ ] **Step 3: Implement validation with fixed rule/action resolution**

Resolve every validator, cross-rule, consumer, strategy, action, and check from catalog+manifest only. Run fixed application validators with an explicit minimal environment, stdin/file input contract, output cap, timeout, and value-free error mapping. Store only encrypted provisional content and returned fingerprints/digest.

- [ ] **Step 4: Implement descriptor-safe atomic writers**

Reuse the read guards from Phase 2. Materialize complete new bytes through the source adapter, create a random sibling temp using exclusive/no-follow flags, apply original metadata, sync, rename, sync parent, reopen, parse, and compare expected HMAC source fingerprint. The writer accepts verified source descriptors from the manifest loader, never a string path from protocol data.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx vitest run apps/config-agent/src/changes/validationService.test.ts apps/config-agent/src/changes/atomicSourceWriter.test.ts apps/config-agent/src/adapters apps/config-agent/src/security
npx tsc -p apps/config-agent/tsconfig.json --noEmit
```

```bash
git add config/variables/catalog.yaml deploy/ops/config-agent/manifest.yaml apps/config-agent/src/changes/validationService.ts apps/config-agent/src/changes/validationService.test.ts apps/config-agent/src/changes/atomicSourceWriter.ts apps/config-agent/src/changes/atomicSourceWriter.test.ts apps/config-agent/src/adapters
git commit -m "feat(config-agent): validate and atomically write managed variables"
```

---

## Task 5: Add Fixed Runtime Actions and Health Checks

**Files:**

- Create `actionRunner.ts`, `healthCheckRunner.ts`, and tests.
- Modify root-owned manifest inputs and systemd policy.

- [ ] **Step 1: Write failing action-runner tests**

Define manifest fixtures for `no_runtime_action`, `next_job`, `runtime_restart`, and `credential_restart`. Prove callers select only the impact plan/change ID; they cannot add or override an action, executable, argument, environment entry, working directory, unit, PM2 process, or timeout.

Test fixed-argv process spawning, minimal environment, stdout/stderr cap, timeout/process-group kill, non-zero exit, signal exit, service instability during the observation window, and idempotent action replay keyed by run+action ID. `next_job` returns an explicit `takes_effect_next_run` result and never claims that the job executed.

- [ ] **Step 2: Write failing health-check tests**

Cover fixed local readiness, public HTTPS smoke, systemd/PM2 active-and-stable checks, expected release/config identity, safe dependency probe, agent self-health, and API health. Test timeouts, redirects where forbidden, TLS/hostname failure, response/body caps, wrong release ID, flapping process, and attempts to redirect to an unapproved target.

Health results expose check IDs, timing, attempt count, and reason codes only.

- [ ] **Step 3: Implement manifest-resolved runners**

Use `spawn`/`execFile` with arrays and `shell: false`. HTTPS checks use exact manifest host/path/port and pinned redirect policy. Enforce per-check and total action budgets. Record enough value-free state for recovery after agent restart.

- [ ] **Step 4: Tighten systemd write/execute permissions**

Add only the source parents, agent state directory, release staging roots, and fixed binaries required by the enabled strategies. Keep `ProtectSystem=strict`; enumerate `ReadWritePaths`; keep arbitrary network families disabled except what declared HTTPS health checks require. Do not grant an interactive shell or unrestricted sudo.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx vitest run apps/config-agent/src/changes/actionRunner.test.ts apps/config-agent/src/changes/healthCheckRunner.test.ts deploy/ops/systemd-assets.test.ts
npx tsc -p apps/config-agent/tsconfig.json --noEmit
```

```bash
git add apps/config-agent/src/changes/actionRunner.ts apps/config-agent/src/changes/actionRunner.test.ts apps/config-agent/src/changes/healthCheckRunner.ts apps/config-agent/src/changes/healthCheckRunner.test.ts deploy/ops/config-agent/manifest.yaml deploy/ops/systemd/ops-config-agent.service deploy/ops/systemd-assets.test.ts
git commit -m "feat(config-agent): run fixed actions and health checks"
```

---

## Task 6: Orchestrate Apply, Automatic Rollback, Restart Recovery, and Application Blocks

**Files:**

- Create agent apply/recovery files and tests.
- Modify authenticated protocol server/index.

- [ ] **Step 1: Write failing apply-state tests**

Test monotonic/idempotent transitions and one active run per application. Before the first write, assert the coordinator verifies sealed-envelope digest/expiry/key/catalog/manifest versions and all current source fingerprints, acquires application+source/action locks, and records an encrypted snapshot.

Inject failure at every boundary: precondition, snapshot, each source write, action start, action timeout, each health check, rollback source restore, release restore, rollback action, and rollback health. Expected outcomes are:

- pre-write failure: active state unchanged, run terminates without rollback claim;
- post-write/action/health failure: automatic `ROLLING_BACK` then `ROLLED_BACK` when previous health passes;
- rollback/rollback-health failure: `ROLLBACK_FAILED`, evidence retention, Critical incident request, and application block.

- [ ] **Step 2: Write failing crash/reconciliation tests**

Terminate/recreate the coordinator after each persisted state. `changeRecovery` must inspect encrypted agent state and fixed system state, then resume the same idempotent run or enter rollback; it must never start a second apply. Test API disconnect/restart independently: agent continues and `change.status` reports progress.

`application.clearApplyBlock` requires owner actor context, exact app-ID confirmation verified by the API, a freshly consumed `accounts_write` grant, and a matching remediated incident plus manifest-declared health evidence record. Config Agent resolves the app from the exact existing block ID and rejects browser-selected paths/actions/checks.

Run: `npx vitest run apps/config-agent/src/changes/applyStateMachine.test.ts apps/config-agent/src/changes/applyCoordinator.test.ts apps/config-agent/src/changes/changeRecovery.test.ts`

Expected: fail because orchestration is absent.

- [ ] **Step 3: Implement apply and rollback transaction**

Persist value-free agent journal records with atomic/fsynced writes. Apply sequence: verify → lock → snapshot → write all → run actions → health → completed. Rollback restores exact bytes/metadata and previous release/process state, runs declared rollback action/checks, and never discards snapshots before retention eligibility.

Register mutation operations only when the matching server-side feature flag is enabled. Capabilities response lists each strategy independently so API/UI cannot infer write availability from a generic agent-up signal.

- [ ] **Step 4: Implement incident/block callbacks without values**

On rollback failure, emit a signed result containing only application/change/run/snapshot IDs, failed action/check IDs, reason code, and timestamps. The API persists the block, opens a Critical incident through the existing monitoring path, and triggers configured alerts. No source path, variable name/value, command output, or file bytes enter the incident.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx vitest run apps/config-agent/src/changes apps/config-agent/src/protocol
npx tsc -p apps/config-agent/tsconfig.json --noEmit
```

```bash
git add apps/config-agent/src/changes apps/config-agent/src/protocol/authenticatedServer.ts apps/config-agent/src/index.ts
git commit -m "feat(config-agent): apply changes with automatic rollback"
```

---

## Task 7: Expose Draft, Validate, Save, Apply, Status, and SSE APIs

**Files:**

- Create API change service/routes/events and tests.
- Modify API runtime/index and Variables routes.

- [ ] **Step 1: Write failing route authorization tests**

For all config mutation routes, test canonical active session, strict Origin, CSRF, Variables permission, and rollout flag. Every role succeeds under the same rules. Inactive accounts fail. `POST .../apply` additionally requires a one-use `variables_apply` grant bound to user/session/IP/user-agent/change ID/current digest.

Test `POST /api/v1/auth/variables/apply-authorization` verifies current password+TOTP and returns only authorization expiry. A concurrent double apply consumes one grant once; a dispatch failure still leaves it consumed.

- [ ] **Step 2: Write failing lifecycle/API-agent/database tests**

Cover:

- create with one app/reason and optional same-app terminal/validated `supersedesChangeId`;
- replace items with source fingerprints and value-bearing body forwarded once to the agent, never repository/audit/log;
- validate and save metadata/digest/impact;
- reject stale source with HTTP `409` and no force field;
- cancel unapplied draft and remove agent envelope;
- apply under PostgreSQL advisory lock;
- status after browser/API reconnect;
- SSE transition replay by event ID, heartbeat, disconnect, and value-free event schema;
- expiry cleanup;
- application blocked before apply;
- rollback failure creates Critical incident/block;
- `POST /api/v1/config-applications/:appId/apply-block/clear` with owner role, exact app-ID confirmation, non-empty value-free remediation summary, resolved Critical incident, passing manifest health evidence, and a consumed one-use `accounts_write` grant.

Test database rows and captured logs against high-entropy sentinel values after every endpoint.

Run: `npx vitest run apps/api/src/modules/variables/configChangeService.test.ts apps/api/src/modules/variables/configChangeRoutes.test.ts apps/api/src/modules/variables/configChangeEvents.test.ts`

Expected: fail because routes/services are absent.

- [ ] **Step 3: Implement metadata-first service boundaries**

Use explicit DTO destructuring so values are passed only to the immediate agent client call and are not attached to errors/events. Store agent-returned fingerprints/digest/impact after validation. Before apply, atomically consume the bound authorization, acquire the application advisory lock, create/run transition metadata, dispatch idempotently, then poll/reconcile signed agent status.

SSE supports `Last-Event-ID` and reports states/action/check IDs/reason codes/timestamps only. Client disconnect never cancels an apply.

- [ ] **Step 4: Add runtime flags and startup reconciliation**

At API startup, compare agent capabilities with requested flags. Refuse to enable a flag when the agent does not advertise the exact strategy. Reconcile non-terminal DB runs against `change.status` before accepting new applies. Read-only inventory stays available when reconciliation fails, while mutation returns `503 CONFIG_CONTROL_DEGRADED`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx vitest run apps/api/src/modules/variables apps/api/src/infrastructure/configAgentClient.test.ts
npx tsc -p apps/api/tsconfig.json --noEmit
```

```bash
git add apps/api/src/modules/variables apps/api/src/runtime apps/api/src/index.ts
git commit -m "feat(api): orchestrate guarded variable changes"
```

---

## Task 8: Implement Editing, Validation, Apply Confirmation, and Live Progress UI

**Files:**

- Create listed Variables components and tests.
- Modify page/API/styles and add Playwright coverage.

- [ ] **Step 1: Write failing editor-policy tests**

Assert managed+required definitions have Edit but no Delete; managed+optional definitions have both; unknown/observed have neither and show the reason. Forged component/API input is still covered by server/agent tests.

Editor tests cover long/multiline/Unicode values, safe text rendering of HTML/script payloads, per-type client hints, explicit deletion confirmation, duplicate precedence warning, source fingerprint inclusion, and clearing draft values on route leave/lock/session loss.

- [ ] **Step 2: Write failing staged/apply-flow tests**

Drive the approved flow:

```text
Draft -> Validate -> Save -> Apply authorization -> Apply -> Health-check -> Completed
                                                      \-> Rollback -> Rolled back/Rollback failed
```

Assert Save remains disabled until validation is current; editing after `READY` or `INVALID` creates a linked replacement `DRAFT` rather than reversing state, invalidating the prior digest/impact; external conflict requires reload and a replacement draft; Apply shows exact impact actions/checks and requires reason plus password/TOTP; reconnect resumes via status/SSE; `next_job` uses accurate “next run” language.

`ROLLBACK_FAILED` displays Critical/app-block guidance without diagnostic values and provides an owner-only link to the incident workflow, not a generic unblock button.

- [ ] **Step 3: Implement page-local secret state and value-free durable state**

Keep new/old values in `VariablesPage` local state only. The staged panel may retain change ID, state, fingerprints, digest, and impact in memory, but never values in routing/history/storage/telemetry. Use direct no-store requests. On lock/expiry, clear inventory and unsaved draft values; a saved encrypted agent change may remain resumable by ID after re-unlock.

- [ ] **Step 4: Implement Apply reauthentication and SSE progress**

The confirmation dialog collects password+TOTP only when the current saved digest is displayed. Submit proof to the apply-authorization route, then apply by change ID; do not expose the grant ID/token. Close/reopen uses `GET change` plus SSE replay and does not re-submit values.

- [ ] **Step 5: Add browser/security tests**

Playwright covers all roles, required/optional/unknown/observed controls, stale conflict, validation errors, successful runtime change, apply proof failure, SSE reconnect, automatic rollback, rollback failed block, expiry/lock clearing, XSS text rendering, CSP rejection of third-party script/connect, and absence of sentinels from storage/URL/history/console/error-report stubs.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx vitest run apps/web/src/web
npx playwright test apps/web/e2e/variables-readonly.spec.ts apps/web/e2e/variables-mutation.spec.ts
npx tsc -p apps/web/tsconfig.json --noEmit
```

```bash
git add apps/web/src/web apps/web/e2e/variables-mutation.spec.ts
git commit -m "feat(web): stage and apply variable changes"
```

---

## Task 9: Teach EduTrack Release Tooling About Configuration-Derived Releases

**Repository:** `/home/deploy/edutrack-platform`

**Files:** all EduTrack files listed in File Structure.

- [ ] **Step 1: Write failing release-identity tests before script edits**

Extend `deploy/vps/canonical-release-assets.test.ts` and environment tests to accept:

```text
sourceSha     = 0123456789abcdef0123456789abcdef01234567
configDigest = 64 lowercase hex characters
releaseId    = 0123456789abcdef0123456789abcdef01234567-cfg-<configDigest>
```

Reject dirty/untracked build inputs, non-40-char source SHA, malformed/mixed-case digest, path separators, ambiguous suffixes, missing source commit, mutable current-worktree builds, and release-root escape. Assert `APP_COMMIT_SHA` stays the bare 40-character SHA while `APP_RELEASE_ID` and `APP_CONFIG_DIGEST` carry derived identity.

Run:

```bash
npx vitest run deploy/vps/canonical-release-assets.test.ts deploy/vps/environment-safety.test.ts scripts/vite-portal-env-boundary.test.ts scripts/validate-staff-build-env.test.ts
```

Expected: fail because existing scripts assume the release name is the bare SHA.

- [ ] **Step 2: Add explicit release identity inputs**

Refactor `prepare-platform-release.sh` and `activate-platform-release.sh` to accept separately validated `--source-sha`, `--release-id`, and `--config-digest`. Default code-only releases may derive a documented zero/config digest identity, but must use the same canonical validation path. Never parse the source SHA back out of an arbitrary directory name when the exact field can be carried explicitly.

Update environment preparation/validation, ecosystem runtime values, and release artifact metadata to emit all three identity fields. Keep source-map/source-correlation logic on `APP_COMMIT_SHA`.

- [ ] **Step 3: Enforce isolated clean-SHA builds and minimal environment**

Create a detached temporary Git worktree at the currently active release's exact source SHA, verify `git status --porcelain` is empty, and build there. The Config Agent supplies a generated, mode-`0600` build environment containing only fixed toolchain variables plus catalog-approved public build entries. Do not inherit the agent/API/login shell environment.

Always remove the explicit temporary worktree through the existing release cleanup mechanism after success/failure; validate the path is under the manifest build root before cleanup.

- [ ] **Step 4: Add public-build and bundle secret gates**

Update `validate-staff-build-env` so every frontend variable needs both `sensitivity: public` and `buildAllowed: true`. Reject secret/internal catalog IDs regardless of `VITE_` prefix. Scan output for disallowed variable names and versioned known-secret fingerprints supplied as keyed scanner inputs; the report contains IDs/digests/result only, never matched bytes.

- [ ] **Step 5: Test activation and rollback**

Fixture tests must prepare derived releases, atomically activate `current`, report expected release/config identity, retain previous release, and restore it on injected readiness/public smoke failure. Verify a code-only release still works and a config-derived release does not corrupt canonical retention/cleanup logic.

- [ ] **Step 6: Run the EduTrack regression suite and commit in that repository**

Run:

```bash
npx vitest run deploy/vps/canonical-release-assets.test.ts deploy/vps/environment-safety.test.ts scripts/vite-portal-env-boundary.test.ts scripts/validate-staff-build-env.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: all commands exit `0`; no working-tree source is used by the build fixture.

```bash
git add deploy/vps scripts/consolidation/releaseArtifact.mjs scripts/vite-portal-env-boundary.test.ts scripts/validate-staff-build-env.mjs scripts/validate-staff-build-env.test.ts
git commit -m "feat(release): support config-derived release identity"
```

Record this EduTrack commit SHA in the Ops manifest compatibility field before enabling `build_redeploy`.

---

## Task 10: Integrate `build_redeploy` into the Config Agent

**Repository:** `/home/deploy/edutrack-ops`

- [ ] **Step 1: Write failing builder integration tests**

Using a local fixture Git repository and fake release scripts, assert the agent:

- reads current source SHA from verified active release metadata;
- calculates the config digest from canonical validated public build inputs without exposing values;
- forms `<sha>-cfg-<digest>`;
- creates a detached clean worktree under the exact manifest build root;
- passes a minimal environment file and fixed arguments;
- rejects secret/internal/non-buildAllowed input and dirty/missing commit;
- scans bundle before activation;
- activates only after successful build/scan;
- restores prior release and source snapshot on action/health failure;
- preserves `APP_COMMIT_SHA` and verifies `APP_RELEASE_ID`/`APP_CONFIG_DIGEST` health evidence.

Inject failure at checkout, dependency install, build, scan, activation, PM2 reload, local readiness, and public smoke.

- [ ] **Step 2: Add manifest-fixed builder/action/check descriptors**

The deployed manifest pins repository/release/build roots, the minimum compatible EduTrack release-tooling commit from Task 9, executable paths, argument templates, resource/time limits, allowed public catalog IDs, PM2 target, and health checks. Protocol/browser data provides only change/run IDs.

- [ ] **Step 3: Implement build strategy and safe cleanup**

Reuse action runner fixed argv and snapshot/apply rollback. Resolve worktree/release paths beneath allowlisted roots, refuse symlinks/escapes, validate release identity with shared logic, and perform cleanup only on the exact recorded temporary path. Retain previous release through successful health completion and snapshot retention registration.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npx vitest run apps/config-agent/src/changes/actionRunner.test.ts apps/config-agent/src/changes/applyCoordinator.test.ts deploy/ops/systemd-assets.test.ts
npx tsc -p apps/config-agent/tsconfig.json --noEmit
```

```bash
git add config/variables/catalog.yaml deploy/ops/config-agent/manifest.yaml deploy/ops/systemd/ops-config-agent.service apps/config-agent/src/changes
git commit -m "feat(config-agent): rebuild config-derived releases"
```

---

## Task 11: Deployment Gates, Retention Timers, Runbooks, and Failure Drills

**Files:** deployment assets and four runbooks listed above.

- [ ] **Step 1: Write failing deployment/flag tests**

Require separate flags and agent capability checks for draft, runtime/next-job, credential restart, and build/redeploy. Assert a missing capability keeps that strategy disabled without disabling read-only inventory. Require separate systemd credentials, state-directory modes, cleanup timer, explicit write paths, fixed executables, restart recovery, and value-free journald configuration.

- [ ] **Step 2: Add staged deployment and rollback scripts**

Installation sequence:

1. Install code/catalog/manifest with every write flag off.
2. Validate manifest/catalog/key separation and source ownership/mode.
3. Restart agent, negotiate capabilities, reconcile non-terminal state.
4. Enable draft/validate/save and run its drill.
5. Enable one runtime strategy at a time and run apply/rollback drill.
6. Enable build/redeploy only after the compatible EduTrack tooling commit is active and its drill passes.

Any failed capability/preflight/drill reverts flags and service assets to the prior release while leaving encrypted evidence intact.

- [ ] **Step 3: Write complete operator runbooks**

Document:

- catalog review/change process and how an unknown becomes managed/observed;
- safe draft/validation/apply workflow;
- source conflict restage;
- runtime, next-job, credential, and build/redeploy expected evidence;
- automatic rollback interpretation;
- `ROLLBACK_FAILED` incident response and owner unblock prerequisites;
- agent/API restart reconciliation;
- separate key rotation with old-key decryption window and re-encryption procedure;
- 24-hour draft and 30-day snapshot retention/cleanup;
- read-only fallback and full write-disable rollback.

No troubleshooting command may dump environment files, decrypted envelopes, snapshots, process environments, request bodies, or journal binary buffers.

- [ ] **Step 4: Run disposable VPS-style failure drills**

Against sandbox services and fixture roots, execute and record value-free evidence for:

- harmless runtime change success and reversal;
- `next_job` annotation;
- credential restart;
- external edit conflict;
- restart failure with successful rollback;
- health failure with successful rollback;
- partial multi-source write with rollback;
- injected rollback failure producing Critical incident/application block;
- owner remediation and unblock;
- API and agent restart during apply;
- Vite public-variable rebuild from active clean SHA and prior-release rollback.

Each drill must assert sentinel values are absent from DB, audit, logs, metrics, traces, URLs, SSE, incident, and browser storage.

- [ ] **Step 5: Run all final verification from clean checkouts**

In `/home/deploy/edutrack-ops`:

```bash
npm run variables:coverage -- --manifest deploy/ops/config-agent/manifest.yaml --catalog config/variables/catalog.yaml --repo /home/deploy/edutrack-ops --repo /home/deploy/edutrack-platform
npm run typecheck
npm run lint
npm run test
npm run build
npm run format:check
npx playwright test apps/web/e2e/variables-readonly.spec.ts apps/web/e2e/variables-mutation.spec.ts
```

In `/home/deploy/edutrack-platform`:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Expected: every command exits `0`; both `git status --short` outputs contain only the intended committed plan/implementation state.

- [ ] **Step 6: Commit Ops deployment documentation/assets**

```bash
git add deploy/ops docs/runbooks apps/api/src/runtime
git commit -m "ops(config): gate rollout and document recovery"
```

Do not enable live flags as part of this commit. Production rollout is a separate, explicit runbook execution requiring current backups, recovery access, and operator approval.

---

## Plan Completion Gate

- [ ] Managed required variables can be edited but not deleted; managed optional variables can be edited/deleted; unknown and observed variables remain read-only in UI, API, and agent.
- [ ] Stale source fingerprints always return conflict with no force-overwrite path.
- [ ] PostgreSQL, audit, logs, metrics, traces, SSE, incidents, URLs, and browser persistence contain no values or reversible value fragments.
- [ ] Saved staging and snapshots use separate authenticated-encryption keys; fingerprints and protocol use two additional separate keys.
- [ ] One-use Apply authorization is bound to the current change digest and consumed on every attempt.
- [ ] Only one apply runs per application and restart/reconnect is idempotently reconciled.
- [ ] Every source write is atomic, metadata-preserving, reparsed, and fingerprint-verified.
- [ ] Runtime, next-job, credential-restart, and build/redeploy strategies execute only fixed manifest actions/checks.
- [ ] Every injected post-write failure automatically rolls back; rollback failure creates a Critical incident, retains evidence, and blocks the application.
- [ ] Build/redeploy uses the currently active clean Git SHA, permits only public allowlisted build values, scans the bundle, and preserves exact `APP_COMMIT_SHA` alongside derived release/config identity.
- [ ] Read-only, draft, runtime apply, credential apply, and build apply can be disabled independently.
- [ ] All required runbooks and failure drills pass before the corresponding production flag is enabled.
- [ ] Full verification passes in both repositories from clean checkouts.
