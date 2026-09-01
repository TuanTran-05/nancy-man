# Ops Config Agent Production Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Variables inventory load successfully on `man.thienuy.edu.vn` by shipping and activating the guarded Config Agent in read-only mode.

**Architecture:** The existing Ops API remains the only public entrypoint. It negotiates and reads inventory over the HMAC-authenticated Unix socket exposed by `ops-config-agent.service`; release preparation must carry every binary and deployment asset required to install that service. SQL Console remains dark-launched, so its separately gated credentials are excluded from the mandatory read-only manifest until that rollout is approved.

**Tech Stack:** TypeScript, Vitest, Node.js 22, Bash, systemd, Unix sockets, YAML.

**Spec:** `docs/superpowers/specs/2026-08-31-ops-variables-access-management-design.md`

## Global Constraints

- Keep `OPS_VARIABLES_DRAFT_ENABLED=false`, `OPS_VARIABLES_RUNTIME_APPLY_ENABLED=false`, and `OPS_VARIABLES_BUILD_APPLY_ENABLED=false`.
- Do not create or deploy `production-read-database-url` while `OPS_SQL_READ_ENABLED=false`.
- Never print credential contents or inventory values in tests, smoke output, logs, or deployment evidence.
- Keep the agent non-root; grant read access only through the dedicated source groups and manifest metadata.
- Build and deploy only from a clean, committed, immutable release.
- Preserve one current and one rollback release.

---

### Task 1: Align the mandatory manifest with the dark SQL rollout

**Files:**
- Modify: `deploy/ops/systemd/systemd-assets.test.ts`
- Modify: `deploy/ops/config-agent/manifest.yaml`
- Modify: `deploy/ops/env/api.env.example`

**Interfaces:**
- Consumes: `OPS_SQL_WORKER_ENABLED=false` and `OPS_SQL_READ_ENABLED=false` defaults.
- Produces: manifest version `2026-09-01` with only currently deployed source files.

- [ ] **Step 1: Write the failing policy test**

Parse the canonical YAML manifest and assert that the mandatory source IDs do not contain `ops.credentials.ops_sql_audit_encryption_key` or `ops.credentials.production_read_database_url`, while the SQL feature defaults are false.

- [ ] **Step 2: Run the focused test and observe RED**

Run: `npx vitest run deploy/ops/systemd/systemd-assets.test.ts`

Expected: FAIL because both forbidden dark-launch sources are currently mandatory.

- [ ] **Step 3: Apply the minimal manifest change**

Remove the two source IDs and their source definitions, bump only `manifestVersion` to `2026-09-01`, and update `OPS_CONFIG_AGENT_MANIFEST_VERSION` in the API example. Do not change the catalog or catalog digest.

- [ ] **Step 4: Run the focused test and manifest loader tests**

Run: `npx vitest run deploy/ops/systemd/systemd-assets.test.ts apps/config-agent/src/manifestLoader.test.ts`

Expected: PASS.

### Task 2: Package the complete Config Agent deployment surface

**Files:**
- Modify: `deploy/ops/release-assets.test.ts`
- Modify: `deploy/ops/prepare-release.sh`

**Interfaces:**
- Consumes: built `apps/config-agent/dist/apps/config-agent/src/index.js` and committed deploy assets.
- Produces: an immutable main release containing the agent binary, catalog, manifest, units, environment example, and deployment scripts.

- [ ] **Step 1: Add a failing release integration assertion**

Extend the verified-build fixture with the Config Agent entrypoint, prepare a release, and assert these literal paths exist in the prepared release:

```text
apps/config-agent/dist/apps/config-agent/src/index.js
config/variables/catalog.yaml
deploy/ops/config-agent/manifest.yaml
deploy/ops/env/config-agent.env.example
deploy/ops/scripts/install-systemd-assets.sh
deploy/ops/scripts/deploy-release.sh
deploy/ops/systemd/ops-config-agent.service
```

- [ ] **Step 2: Run the release test and observe RED**

Run: `npx vitest run deploy/ops/release-assets.test.ts`

Expected: FAIL because the current release allowlist omits the catalog, manifest, scripts, and units.

- [ ] **Step 3: Extend the release allowlist and prerequisites**

Require the Config Agent build entrypoint, add `config-agent` to required app metadata, and copy the exact Git blobs listed by the failing test plus cleanup service/timer/tmpfiles assets.

- [ ] **Step 4: Run release tests**

Run: `npx vitest run deploy/ops/release-assets.test.ts deploy/ops/release-manifest.test.ts`

Expected: PASS and the prepared release remains secret-free and immutable.

### Task 3: Supply the signed, value-free smoke client required by deployment

**Files:**
- Create: `apps/api/src/cli/smoke-config-agent.ts`
- Create: `apps/api/src/cli/smoke-config-agent.test.ts`
- Create: `apps/api/scripts/config-agent-smoke.sh`
- Modify: `apps/api/package.json`
- Modify: `deploy/ops/scripts/install-systemd-assets.sh`
- Modify: `deploy/ops/systemd/systemd-assets.test.ts`
- Modify: `deploy/ops/prepare-release.sh`

**Interfaces:**
- Consumes: `ConfigAgentClient`, the API service credential mount, and the deployed manifest/catalog.
- Produces: `/usr/local/libexec/edutrack-config-agent-smoke` supporting exactly `agent.capabilities --socket <absolute.sock>` and `inventory.read --socket <absolute.sock> --ids-only`.

- [ ] **Step 1: Write failing CLI behavior tests**

Use a real argument parser with a narrow fake client boundary. Assert capability output contains only protocol/version/digest/operation metadata; inventory output contains only versions, count, and sorted IDs; assert serialized output never contains an inventory `value`.

- [ ] **Step 2: Run the CLI tests and observe RED**

Run: `npx vitest run apps/api/src/cli/smoke-config-agent.test.ts`

Expected: FAIL because the smoke CLI does not exist.

- [ ] **Step 3: Implement the minimal CLI and wrapper**

Load the HMAC from `/run/credentials/edutrack-ops-api.service/config-agent-protocol-hmac`, derive negotiation expectations from the deployed YAML files, call `negotiate()` before either result, and map every unexpected failure to `CONFIG_AGENT_SMOKE_FAILED` without printing error messages or response bodies. Build a fixed launcher that executes the CLI from the immutable active release so relative module imports remain inside the attested tree.

- [ ] **Step 4: Install and package the wrapper atomically**

Add a regular-file preflight and install the wrapper mode `0755` to `/usr/local/libexec/edutrack-config-agent-smoke`; include the wrapper in prepared releases.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx vitest run apps/api/src/cli/smoke-config-agent.test.ts deploy/ops/systemd/systemd-assets.test.ts deploy/ops/release-assets.test.ts && npx tsc -p apps/api/tsconfig.json --noEmit`

Expected: PASS.

### Task 4: Verify, release, and recover production read-only inventory

**Files:**
- Runtime-only: `/etc/edutrack-ops/config-agent.env`
- Runtime-only: `/etc/edutrack-ops/api.env`
- Runtime-only credentials: three missing independent Config Agent keys

**Interfaces:**
- Consumes: clean committed SHA and the release scripts from Tasks 1-3.
- Produces: active Config Agent socket and successful Variables inventory reads with all mutation gates false.

- [ ] **Step 1: Run the full relevant verification suite**

Run the Config Agent, Variables API/UI, release, systemd, typecheck, lint, format, and build checks. Require zero failures.

- [ ] **Step 2: Review, commit, and push**

Review the exact diff, commit one cohesive production-recovery change, push the production branch, and verify local HEAD equals the remote SHA.

- [ ] **Step 3: Build and prepare the immutable main release**

Build from a clean checkout at the committed SHA, write the attestation marker, run `prepare-release.sh`, verify the release manifest, and activate with the existing rollback release preserved.

- [ ] **Step 4: Stage Config Agent prerequisites without exposing values**

Generate distinct fingerprint, staging, and snapshot keys; install all Config Agent credentials as `root:root 0400`; install `config-agent.env` as `root:edutrack-ops 0640`; apply the allowlisted `edutrack-config-agent`/`edutrack-ops`/`deploy` source groups and exact manifest modes; keep all three mutation flags false.

- [ ] **Step 5: Deploy through the signed gate**

Run `deploy/ops/scripts/deploy-release.sh <immutable-release>`. Require agent capabilities, inventory IDs-only smoke, API restart negotiation, and public `/healthz` to pass before accepting the rollout.

- [ ] **Step 6: Verify production state**

Require the socket to be `0660` in `edutrack-config-api`, both services active, mutation flags false, public health OK, no failed systemd units, no value-like agent logs, and exactly current plus rollback main releases.
