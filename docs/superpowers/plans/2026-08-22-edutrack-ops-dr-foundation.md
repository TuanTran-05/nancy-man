# EduTrack Ops Disaster-Recovery Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish and prove continuous PostgreSQL recovery with RPO <= 60 seconds and RTO <= 15 minutes before the production SQL console can mutate data.

**Architecture:** Keep the existing encrypted logical `pg_dump` as an independent export layer, and add pgBackRest full/differential backups plus continuous WAL archiving to a separate self-hosted backup host. Maintain a streaming warm standby and a ready isolated recovery target. Encode wrong-target guards, measured drills, and a machine-readable mutation gate.

**Tech Stack:** PostgreSQL 16, pgBackRest, Bash, Node.js 22/TypeScript, Vitest, age, rclone, systemd/cron, TLS/SSH private network.

**Spec:** `docs/superpowers/specs/2026-08-22-edutrack-ops-plane-design.md`

## Global Constraints

- Production backup, standby, Ops, and recovery-target hosts must not be the same VPS.
- Never print `DATABASE_URL`, repository passphrases, private keys, backup recipient identities, or production row data.
- The existing `deploy/vps/backup-postgres.sh` logical backup remains enabled until two complete pgBackRest restore cycles and one monthly logical restore both pass.
- Set `archive_timeout=60s`; alert if the newest successfully archived WAL is older than 60 seconds.
- Retain at least 35 days of recoverable WAL/base backups and validate capacity before rollout.
- A restore target must have a distinct host/database/system identifier from production; ambiguity aborts recovery.
- No drill may overwrite, restart, promote, or repoint production unless the drill explicitly has separate production-change approval.
- RPO and RTO are measured, not inferred from configuration.

---

### Task 1: Define the DR configuration contract and mutation gate

**Files:**
- Create: `edutrack-ops/deploy/dr/dr-config.ts`
- Create: `edutrack-ops/deploy/dr/dr-config.test.ts`
- Create: `edutrack-ops/deploy/dr/dr-status.schema.ts`
- Create: `edutrack-ops/deploy/dr/fixtures/valid.env`
- Create: `edutrack-ops/deploy/dr/fixtures/invalid-same-host.env`

**Interfaces:**
- Produces: `readDrConfig(env): DrConfig`, `assertDistinctRecoveryTargets(config)`, and `DrGateStatus` used by deployment, drills, and Ops API.

- [ ] **Step 1: Write failing configuration tests**

```ts
it('requires independent host identities and an archive timeout of at most 60 seconds', () => {
  const config = readDrConfig(validEnv);
  expect(config.archiveTimeoutSeconds).toBeLessThanOrEqual(60);
  expect(new Set([config.productionHostId, config.backupHostId, config.standbyHostId]).size).toBe(3);
});

it('rejects a recovery host that resolves to production', () => {
  expect(() => readDrConfig(invalidSameHostEnv)).toThrow(/must be distinct/i);
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npx vitest run deploy/dr/dr-config.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement exact types and validation**

```ts
export type DrConfig = {
  productionHostId: string;
  backupHostId: string;
  standbyHostId: string;
  isolatedRestoreHostId: string;
  stanza: 'edutrack';
  archiveTimeoutSeconds: number;
  retentionDays: number;
  rpoTargetSeconds: 60;
  rtoTargetSeconds: 900;
};

export type DrGateStatus = {
  approved: boolean;
  approvedAt: string | null;
  evidenceSha256: string | null;
  measuredRpoSeconds: number | null;
  measuredRtoSeconds: number | null;
  expiresAt: string | null;
};
```

Require four non-empty, pairwise-distinct host IDs, `archiveTimeoutSeconds` from 1–60, and `retentionDays >= 35`.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx vitest run deploy/dr/dr-config.test.ts
git add deploy/dr/dr-config.ts deploy/dr/dr-config.test.ts deploy/dr/dr-status.schema.ts deploy/dr/fixtures
git commit -m "feat(dr): define recovery configuration and gate"
```

---

### Task 2: Provision the off-host pgBackRest repository

**Files:**
- Create: `edutrack-ops/deploy/dr/pgbackrest/backup-host.conf.template`
- Create: `edutrack-ops/deploy/dr/pgbackrest/primary.conf.template`
- Create: `edutrack-ops/deploy/dr/install-backup-host.sh`
- Create: `edutrack-ops/deploy/dr/verify-backup-host.sh`
- Test: `edutrack-ops/deploy/dr/pgbackrest-config.test.ts`

**Interfaces:**
- Consumes: validated `DrConfig` and secrets injected on each host.
- Produces: stanza `edutrack`, encrypted repository, retention settings, and `verify-backup-host.sh --json` without secret output.

- [ ] **Step 1: Write template tests**

Assert the rendered repository configuration contains:

```text
[global]
repo1-retention-full=5
repo1-retention-diff=35
repo1-cipher-type=aes-256-cbc
start-fast=y
process-max=2

[edutrack]
pg1-path=/var/lib/postgresql/16/main
```

Also assert templates contain no literal password, private key, production URL, or wildcard host.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run deploy/dr/pgbackrest-config.test.ts`

Expected: FAIL because templates/scripts do not exist.

- [ ] **Step 3: Implement idempotent backup-host installation**

The script must:

- require root and an explicit `--host-id` matching configuration;
- install a pinned distro pgBackRest package;
- create `pgbackrest` user/directories with mode `0700`;
- install only public SSH keys/TLS CAs from supplied files;
- write `/etc/pgbackrest/pgbackrest.conf` mode `0640` from the template;
- keep repository cipher passphrase in a root-readable systemd credential file, never the template;
- run `pgbackrest --stanza=edutrack stanza-create` and `check`;
- emit host ID, stanza status, repository size, and newest backup time only.

- [ ] **Step 4: Implement verification**

`verify-backup-host.sh --json` must return:

```json
{
  "hostId": "backup-01",
  "stanza": "edutrack",
  "status": "ok",
  "latestFullAt": "2026-08-22T00:00:00Z",
  "latestWalAt": "2026-08-22T00:00:00Z",
  "repositoryBytes": 1
}
```

Dates/bytes are real runtime values; no credential or file listing appears.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx vitest run deploy/dr/pgbackrest-config.test.ts
shellcheck deploy/dr/*.sh
git add deploy/dr
git commit -m "feat(dr): provision off-host pgbackrest repository"
```

---

### Task 3: Enable continuous WAL archive on production

**Files:**
- Create: `edutrack-ops/deploy/dr/postgresql/primary.fragment.conf`
- Create: `edutrack-ops/deploy/dr/postgresql/archive-check.sh`
- Create: `edutrack-ops/deploy/dr/postgresql/archive-check.test.ts`
- Modify: `edutrack/deploy/vps/validate-host.sh`
- Modify: `edutrack/deploy/vps/crontab`

**Interfaces:**
- Produces: continuous archive, a one-minute lag check, and machine-readable archive health.

- [ ] **Step 1: Write failing fragment and lag tests**

The test requires exact settings:

```text
wal_level = replica
archive_mode = on
archive_timeout = '60s'
archive_command = 'pgbackrest --stanza=edutrack archive-push %p'
max_wal_senders = 10
wal_keep_size = '2048MB'
```

Mock pgBackRest info with newest WAL at 61 seconds and assert `archive-check.sh` exits non-zero with code `wal_archive_lag`.

- [ ] **Step 2: Run RED**

Run: `npx vitest run deploy/dr/postgresql/archive-check.test.ts`

- [ ] **Step 3: Implement configuration and monitoring**

Add `archive-check.sh --json` that reads `pg_stat_archiver`, `pg_current_wal_lsn()`, and pgBackRest info; it emits only status, lag seconds, failed count delta, LSN, and timestamps. Add a per-minute cron/systemd timer. Extend `validate-host.sh` to require pgBackRest check and archive settings.

- [ ] **Step 4: Rehearse on a PostgreSQL 16 clone**

Apply the fragment to an isolated clone, generate controlled writes for five minutes, force `pg_switch_wal()`, and require every segment to pass `archive-get` verification.

- [ ] **Step 5: Apply to production under separate approval**

Before reload/restart, create and verify the existing encrypted logical backup. Apply the fragment, reload settings that support reload, perform the planned PostgreSQL restart for restart-only settings, then require:

```bash
pgbackrest --stanza=edutrack check
pgbackrest --stanza=edutrack --type=full backup
```

Verify archive lag <= 60 seconds. If check fails, restore the previous PostgreSQL configuration and keep SQL mutation disabled.

- [ ] **Step 6: Commit source changes**

```bash
npx vitest run deploy/dr/postgresql/archive-check.test.ts
git add deploy/dr/postgresql
git commit -m "feat(dr): monitor continuous wal archiving"
```

Commit the existing-repo validation/cron change separately in `edutrack`.

---

### Task 4: Build and verify the warm standby

**Files:**
- Create: `edutrack-ops/deploy/dr/standby/bootstrap-standby.sh`
- Create: `edutrack-ops/deploy/dr/standby/standby.fragment.conf`
- Create: `edutrack-ops/deploy/dr/standby/check-replication.sh`
- Test: `edutrack-ops/deploy/dr/standby/standby-config.test.ts`

**Interfaces:**
- Produces: streaming standby with archive fallback and `check-replication.sh --json`.

- [ ] **Step 1: Write failing standby safety tests**

Assert bootstrap rejects the production host ID, a non-empty PostgreSQL data directory, missing TLS CA, and a replication URL whose host resolves to the standby itself.

- [ ] **Step 2: Implement bootstrap**

Use pgBackRest restore or `pg_basebackup` from the approved source, create `standby.signal`, and configure:

```text
primary_conninfo = 'host=<private-primary> port=5432 user=edutrack_replication sslmode=verify-full sslrootcert=<ca>'
restore_command = 'pgbackrest --stanza=edutrack archive-get %f %p'
hot_standby = on
```

The committed template contains variable names, never a password.

- [ ] **Step 3: Implement replication health**

Report receive/replay LSN, byte lag, time lag, archive fallback state, and last heartbeat. Fail when replay/receive stops or the source system identifier differs from the recorded production system identifier.

- [ ] **Step 4: Run clone tests and commit**

```bash
npx vitest run deploy/dr/standby/standby-config.test.ts
shellcheck deploy/dr/standby/*.sh
git add deploy/dr/standby
git commit -m "feat(dr): provision and verify warm standby"
```

- [ ] **Step 5: Provision and observe production standby**

Run for at least 24 hours. Require continuous streaming, successful archive fallback test, no data directory corruption, and lag within the 60-second objective.

---

### Task 5: Implement isolated point-in-time restore orchestration

**Files:**
- Create: `edutrack-ops/apps/sql-worker/src/recovery/targetIdentity.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/targetIdentity.test.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/pitrRestore.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/pitrRestore.test.ts`
- Create: `edutrack-ops/deploy/dr/restore-isolated.sh`
- Create: `edutrack-ops/deploy/dr/verify-restored-database.sh`

**Interfaces:**
- Produces: `assertIsolatedTarget(production, target)` and `restoreToTarget(input): RecoveryEvidence`.

- [ ] **Step 1: Write wrong-target and command-construction tests**

```ts
export type RecoveryEvidence = {
  recoveryId: `RCV_${string}`;
  sourceSystemId: string;
  targetSystemId: string;
  targetHostId: string;
  targetDatabase: string;
  requestedTarget: { timestamp?: string; walLsn?: string };
  pausedAt: string;
  recoveredWalLsn: string;
  verificationStatus: 'pending' | 'passed' | 'failed';
  evidenceSha256: string;
};
```

```ts
expect(() => assertIsolatedTarget(prodIdentity, prodIdentity)).toThrow(/production/i);
expect(buildRecoveryTarget({ timestamp: '2026-08-22T03:14:00Z' })).toEqual({
  type: 'time',
  value: '2026-08-22T03:14:00Z',
  action: 'pause',
});
```

Also require a target host allowlist and a database name prefix `edutrack_recovery_`.

- [ ] **Step 2: Run RED, then implement guard/orchestrator**

The orchestrator creates an execution-specific empty data directory, restores the latest eligible base backup, writes recovery target settings, starts on a private port, waits for `pg_is_in_recovery()`, pauses at target, and emits evidence. It never edits production connection configuration.

- [ ] **Step 3: Implement verification script**

Run the current release's `db/verify-schema.sql`, `db/verify-data.sql`, row-count/hash probes for affected tables, and application smoke tests against the isolated URL. Any `FAIL` marks recovery unverified.

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run apps/sql-worker/src/recovery deploy/dr
shellcheck deploy/dr/restore-isolated.sh deploy/dr/verify-restored-database.sh
git add apps/sql-worker/src/recovery deploy/dr
git commit -m "feat(dr): restore postgres to guarded isolated targets"
```

---

### Task 6: Add named restore points and recovery evidence

**Files:**
- Create: `edutrack-ops/apps/sql-worker/src/recovery/restorePoint.ts`
- Create: `edutrack-ops/apps/sql-worker/src/recovery/restorePoint.test.ts`
- Create: `edutrack-ops/packages/contracts/src/recovery.ts`
- Create: `edutrack-ops/packages/db/src/schema/recovery.ts`

**Interfaces:**
- Produces: `createRestorePoint(executionId): Promise<RestorePointEvidence>`.

- [ ] **Step 1: Define the exact evidence contract**

```ts
export type RestorePointEvidence = {
  executionId: string;
  restorePointName: string;
  createdAt: string;
  walLsn: string;
  archivedThroughLsn: string;
  archiveVerified: boolean;
};
```

- [ ] **Step 2: Write tests**

Require safe restore-point names matching `ops_[a-z0-9_]{1,55}`, parameterized execution IDs, and refusal when archived WAL has not reached the restore-point LSN within the configured timeout.

- [ ] **Step 3: Implement minimally**

Call `pg_create_restore_point`, force a WAL switch, poll archive evidence, persist the record, and return only after `archiveVerified=true`. Failure blocks the dangerous SQL execution.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx vitest run apps/sql-worker/src/recovery/restorePoint.test.ts
git add apps/sql-worker/src/recovery packages/contracts/src/recovery.ts packages/db/src/schema/recovery.ts
git commit -m "feat(dr): anchor sql restore points in archived wal"
```

---

### Task 7: Automate measurable recovery drills

**Files:**
- Create: `edutrack-ops/deploy/dr/run-drill.ts`
- Create: `edutrack-ops/deploy/dr/run-drill.test.ts`
- Create: `edutrack-ops/deploy/dr/drill-scenarios.ts`
- Create: `edutrack-ops/deploy/dr/sign-evidence.ts`
- Create: `edutrack-ops/docs/runbooks/postgres-disaster-recovery.md`

**Interfaces:**
- Produces: signed `DrillEvidence` and `DrGateStatus` with one-month expiry.

- [ ] **Step 1: Define scenario matrix and evidence**

```ts
export const requiredScenarios = [
  'single_row_update',
  'mass_delete',
  'truncate_table',
  'drop_table',
  'primary_host_loss',
  'backup_host_unavailable',
  'wrong_target_rejected',
] as const;

export type DrillEvidence = {
  scenario: (typeof requiredScenarios)[number];
  declaredAt: string;
  recoveryTarget: { timestamp: string; walLsn: string };
  lastRecoverableCommitAt: string;
  readyAt: string;
  measuredRpoSeconds: number;
  measuredRtoSeconds: number;
  sourceSystemId: string;
  targetSystemId: string;
  verificationPassed: boolean;
  operatorId: string;
  toolReleaseSha: string;
  evidenceSha256: string;
  signature: string;
};
```

Evidence records declared time, target time/LSN, last recoverable commit, ready time, measured RPO/RTO, verification results, source/target system IDs, operator, tool release SHA, and SHA-256 signature input.

- [ ] **Step 2: Write RED tests for gate evaluation**

Require `approved=false` if any required scenario is absent, any verification fails, RPO > 60, RTO > 900, evidence signature fails, or evidence is older than 31 days.

- [ ] **Step 3: Implement runner and signing**

The runner creates a disposable drill database, records controlled marker transactions, executes one scenario, restores/promotes as specified, runs verification, measures times using monotonic clocks plus UTC timestamps, writes canonical JSON, and signs its SHA-256 with an off-database Ed25519 key.

- [ ] **Step 4: Run CI drills on disposable PostgreSQL**

Run: `npx vitest run deploy/dr/run-drill.test.ts`

Expected: all deterministic gate tests pass. CI does not claim production-host RTO.

- [ ] **Step 5: Run infrastructure drills and commit evidence privately**

Execute all scenarios on production-shaped data and infrastructure. Store signed evidence in the private audit bucket, not Git. Commit only the tooling/runbook.

```bash
git add deploy/dr docs/runbooks/postgres-disaster-recovery.md
git commit -m "feat(dr): automate measured recovery drills"
```

---

### Task 8: Connect health, schedules, and the production mutation gate

**Files:**
- Create: `edutrack-ops/apps/api/src/modules/operations/drHealth.ts`
- Create: `edutrack-ops/apps/api/src/modules/operations/drHealth.test.ts`
- Create: `edutrack-ops/deploy/dr/systemd/edutrack-dr-check.service`
- Create: `edutrack-ops/deploy/dr/systemd/edutrack-dr-check.timer`
- Modify: `edutrack/deploy/vps/backup-postgres.sh`
- Modify: `edutrack/deploy/vps/restore-postgres-drill.sh`

**Interfaces:**
- Consumes: signed gate, archive/standby/backup checks.
- Produces: `getDrHealth(): DrHealth` and `assertMutationRecoveryGate()`.

- [ ] **Step 1: Write gate tests**

Use this aggregate contract:

```ts
export type DrHealth = {
  checkedAt: string;
  gate: DrGateStatus;
  archive: { healthy: boolean; lagSeconds: number; failedCountDelta: number };
  standby: { healthy: boolean; receiveLagBytes: number; replayLagSeconds: number };
  baseBackup: { healthy: boolean; newestCompletedAt: string; verified: boolean };
  auditReceiver: { healthy: boolean; lastAnchorAt: string };
  mutationAllowed: boolean;
  blockingCodes: string[];
};
```

```ts
await expect(assertMutationRecoveryGate(expiredEvidence)).rejects.toThrow('DR_GATE_EXPIRED');
await expect(assertMutationRecoveryGate(healthyEvidence)).resolves.toBeUndefined();
```

Also reject archive lag > 60 seconds, missing recent base backup, unhealthy standby, failed signature, or unavailable off-host audit receiver.

- [ ] **Step 2: Implement health aggregation and scheduled checks**

Run archive/standby checks every minute, base-backup checks hourly, restore smoke weekly, full scenario drill monthly, and logical restore monthly. Emit Critical issues for broken archive/backup chains.

- [ ] **Step 3: Extend current logical scripts without weakening guards**

Add structured completion evidence and an optional HMAC heartbeat to Ops after successful backup/drill. Preserve the current encrypted dump, checksum, offsite copy, non-production target identity, and `FAIL` scan behavior.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run apps/api/src/modules/operations/drHealth.test.ts deploy/dr
shellcheck deploy/dr/**/*.sh
git add apps/api/src/modules/operations deploy/dr
git commit -m "feat(dr): enforce recovery health before sql mutation"
```

Commit the existing-repo script changes separately after its `npm run test:vps` passes.

**Exit gate:** signed production-shaped drills prove every required scenario, maximum RPO <= 60 seconds, maximum RTO <= 900 seconds, archive/standby health is green, and `OPS_SQL_MUTATION_ENABLED` remains `false` pending rollout approval.
