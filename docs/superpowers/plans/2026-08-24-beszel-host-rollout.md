# Beszel Host Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cài Beszel Hub/Agent `v0.18.8` dạng binary systemd chỉ trên loopback, provision quyền read-only, backup/restore an toàn và bật tích hợp Ops Console qua một pilot có rollback rõ ràng.

**Architecture:** Repository chứa manifest/checksum/license, installer idempotent theo immutable release directory, hai unit chạy bằng hai OS user riêng và Agent dùng outbound WebSocket. Hub data/Agent fingerprint/backup nằm ngoài release; Ops collector đọc Hub bằng user readonly; production enable đi sau build, contract test và pilot 30 phút.

**Tech Stack:** Bash, systemd, Beszel `v0.18.8`, PocketBase SQLite, sqlite3 CLI, age, SHA-256, existing Ops release workflow.

**Spec:** `docs/superpowers/specs/2026-08-24-beszel-telemetry-integration-design.md`

## Global Constraints

- Backend và dashboard plans ngày `2026-08-24` phải hoàn tất, toàn bộ test/build/E2E xanh trước host rollout.
- Tag pin: `v0.18.8`; commit: `0a9cad31d90b0902302d7a3c538b53c2a548c3cb`.
- Hub archive: `beszel_linux_amd64.tar.gz`; SHA-256 `c4924f01a3def7d307fe7cb9776dee547240b51aa0e7222b7e6d47c2cbdf9916`.
- Agent archive: `beszel-agent_linux_amd64.tar.gz`; SHA-256 `ea964141aa4182742475c0a75b29001fc591eb39ce0f63a33bd3cff04539bcf9`.
- Artifact source is the immutable GitHub release URL under `/releases/download/v0.18.8/`; never use `latest`, branch `main`, upstream installer or update command.
- Release provenance is checked with GitHub artifact attestation before host install, in addition to the pinned SHA-256 values.
- Hub listens only `127.0.0.1:8090`; Agent sets `DISABLE_SSH=true` and must not listen `45876`.
- Hub runs as `beszel-hub`; Agent runs as `beszel-agent`; neither runs as root or `deploy`.
- Docker, GPU and SMART collection disabled; systemd allowlist is `nginx*,postgresql*,edutrack-ops-*,pm2-*`.
- Secret values are never in git, unit command line, journal, release manifest or shell history.
- No Nginx change and no public Beszel UI in v1; operator provisioning uses an SSH local port forward.
- Rollout may restart only `beszel-hub`, `beszel-agent`, `edutrack-ops-collector` and `edutrack-ops-web`.
- Never restart/modify EduTrack PM2, PostgreSQL, Nginx or their data during rollout/rollback.
- Production activation requires an approved maintenance window and operator sign-off; this plan is not by itself authorization to cut over.
- Execute code/asset tasks in the isolated worktree used by the backend/dashboard plans. Execute host commands only after the production gate is explicitly approved.

---

## File map

- `ops-console/deploy/beszel/version.env`: immutable release identifiers, filenames and checksums only.
- `ops-console/deploy/beszel/LICENSE`: upstream MIT license pinned with the release.
- `ops-console/deploy/beszel/install-beszel.sh`: root-only download, verification, release activation, users/directories and unit installation; does not start services.
- `ops-console/deploy/beszel/hub.env.example`: non-secret Hub safety switches.
- `ops-console/deploy/beszel/agent.env.example`: secret file paths and disabled collectors; no key/token value.
- `ops-console/deploy/beszel/backup.env.example`: age recipient only.
- `ops-console/deploy/beszel/backup-beszel.sh`: consistent SQLite backup, encryption, checksum, daily/weekly retention.
- `ops-console/deploy/beszel/restore-beszel-drill.sh`: decrypt/integrity-check into a temporary directory only.
- `ops-console/deploy/systemd/beszel-{hub,agent}.service`: hardened runtime units.
- `ops-console/deploy/systemd/beszel-backup.{service,timer}`: daily encrypted backup after Ops backup.
- `ops-console/deploy/deployment-assets.test.ts`: static regression tests for every security invariant above.
- `ops-console/deploy/collector.env.example`: feature flag/config paths.
- `ops-console/src/cli/smoke-beszel.ts`: production contract smoke chỉ in safe aggregate.
- `ops-console/src/cli/smoke-beszel.test.ts`: chứng minh output không chứa identifier/credential/raw record.
- `ops-console/scripts/build-server.mjs`, `ops-console/deploy/release-ops.sh`: build và bắt buộc smoke artifact.
- `ops-console/deploy/README.md`, `release-checklist.md`: operator sequence and evidence gates.
- `docs/runbooks/beszel-telemetry-rollout.md`: provision, pilot, release, rollback and restore rehearsal commands.

### Task 1: Pin release metadata, license and deployment invariants

**Files:**
- Create: `ops-console/deploy/beszel/version.env`
- Create: `ops-console/deploy/beszel/LICENSE`
- Modify: `ops-console/deploy/deployment-assets.test.ts`

**Interfaces:**
- Produces shell-safe constants consumed by installer and backup metadata.

- [ ] **Step 1: Write failing asset tests before assets exist**

```ts
it('pins immutable Beszel v0.18.8 amd64 artifacts', () => {
  const version = read('deploy/beszel/version.env');
  expect(version).toContain('BESZEL_VERSION=0.18.8');
  expect(version).toContain('BESZEL_TAG_COMMIT=0a9cad31d90b0902302d7a3c538b53c2a548c3cb');
  expect(version).toContain('BESZEL_HUB_SHA256=c4924f01a3def7d307fe7cb9776dee547240b51aa0e7222b7e6d47c2cbdf9916');
  expect(version).toContain('BESZEL_AGENT_SHA256=ea964141aa4182742475c0a75b29001fc591eb39ce0f63a33bd3cff04539bcf9');
  expect(version).not.toMatch(/latest|main|AUTO_UPDATE/);
  expect(read('deploy/beszel/LICENSE')).toContain('MIT License');
});
```

Add tests asserting Hub ExecStart loopback, Agent `DISABLE_SSH`, separate `User=`, no secret literals, exact service patterns, hardening keys, backup `.backup`, `mktemp`, `age`, checksum and fixed-prefix cleanup.

- [ ] **Step 2: Run deployment assets test and confirm RED**

Run: `cd ops-console && npm test -- deploy/deployment-assets.test.ts`

Expected: FAIL because Beszel assets are absent.

- [ ] **Step 3: Add exact shell manifest**

```dotenv
BESZEL_VERSION=0.18.8
BESZEL_TAG_COMMIT=0a9cad31d90b0902302d7a3c538b53c2a548c3cb
BESZEL_RELEASE_DIR=0.18.8-c4924f01-ea964141
BESZEL_HUB_ARCHIVE=beszel_linux_amd64.tar.gz
BESZEL_HUB_SHA256=c4924f01a3def7d307fe7cb9776dee547240b51aa0e7222b7e6d47c2cbdf9916
BESZEL_AGENT_ARCHIVE=beszel-agent_linux_amd64.tar.gz
BESZEL_AGENT_SHA256=ea964141aa4182742475c0a75b29001fc591eb39ce0f63a33bd3cff04539bcf9
```

The file contains no quotes, spaces or executable substitutions. The installer must validate each line before sourcing it.

- [ ] **Step 4: Add upstream MIT license**

Copy the exact `LICENSE` file from tag `v0.18.8` and keep the copyright notice. Do not copy source code or frontend assets.

- [ ] **Step 5: Run the focused test**

Run: `cd ops-console && npm test -- deploy/deployment-assets.test.ts`

Expected: tests for files not yet added in later tasks may remain red; the manifest/license assertions pass.

- [ ] **Step 6: Commit immutable metadata**

```bash
git add ops-console/deploy/beszel/version.env ops-console/deploy/beszel/LICENSE ops-console/deploy/deployment-assets.test.ts
git commit -m "build(ops): pin Beszel 0.18.8 artifacts"
```

### Task 2: Create root-only installer and hardened runtime units

**Files:**
- Create: `ops-console/deploy/beszel/install-beszel.sh`
- Create: `ops-console/deploy/beszel/hub.env.example`
- Create: `ops-console/deploy/beszel/agent.env.example`
- Create: `ops-console/deploy/systemd/beszel-hub.service`
- Create: `ops-console/deploy/systemd/beszel-agent.service`
- Modify: `ops-console/deploy/deployment-assets.test.ts`

**Interfaces:**
- Installer activates `/srv/beszel/current -> /srv/beszel/releases/0.18.8-c4924f01-ea964141` and installs units; it never starts/enables services or creates credentials.

- [ ] **Step 1: Extend failing tests for installer safety**

Assert the script:

- refuses non-root and non-`x86_64`;
- uses `mktemp -d`, `curl -fL`, `sha256sum -c`, `tar -tzf`;
- downloads exact `/v${BESZEL_VERSION}/${archive}` URLs;
- creates `beszel-hub` and `beszel-agent` with nologin;
- creates separate shared directories and an atomic `current` symlink;
- never contains `latest`, `update`, `systemctl start`, `systemctl enable`, `pm2`, `/srv/edutrack/current` or Nginx paths.

- [ ] **Step 2: Create non-secret env examples**

`hub.env.example`:

```dotenv
APP_URL=http://127.0.0.1:8090
SHARE_ALL_SYSTEMS=false
USER_CREATION=false
CHECK_UPDATES=false
CONTAINER_DETAILS=false
```

It must not contain `AUTO_LOGIN`, `TRUSTED_AUTH_HEADER`, `USER_EMAIL` or `USER_PASSWORD` at all.

`agent.env.example`:

```dotenv
HUB_URL=http://127.0.0.1:8090
DISABLE_SSH=true
KEY_FILE=/etc/beszel/agent/key.pub
TOKEN_FILE=/etc/beszel/agent/token
DATA_DIR=/srv/beszel/shared/agent
DOCKER_HOST=
SKIP_GPU=true
SMART_DEVICES=
SERVICE_PATTERNS=nginx*,postgresql*,edutrack-ops-*,pm2-*
```

- [ ] **Step 3: Implement installer validation/download**

The opening must be:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
umask 027
[[ $(id -u) -eq 0 ]] || { echo 'must run as root' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'Beszel manifest is pinned for x86_64' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
manifest=${script_dir}/version.env
[[ -f ${manifest} ]] || { echo 'missing version manifest' >&2; exit 1; }
while IFS= read -r line; do
  [[ ${line} =~ ^BESZEL_[A-Z_]+=[A-Za-z0-9._-]+$ ]] || { echo 'invalid manifest line' >&2; exit 1; }
done < "${manifest}"
# shellcheck disable=SC1090
source "${manifest}"
```

Download into `install_tmp=$(mktemp -d /tmp/edutrack-beszel-install.XXXXXX)` and trap cleanup only for that validated prefix. Verify each checksum with a generated one-line check file in the temp directory. Verify each archive contains exactly its expected executable (`beszel` or `beszel-agent`) before extracting.

- [ ] **Step 4: Implement immutable release activation**

Create system users only if absent. Exact ownership/modes:

```text
/srv/beszel                         root:root          0755
/srv/beszel/releases                root:root          0755
/srv/beszel/releases/0.18.8-c4924f01-ea964141 root:root          0755
/srv/beszel/shared/hub              beszel-hub:beszel-hub     0700
/srv/beszel/shared/agent            beszel-agent:beszel-agent 0700
/srv/beszel/shared/backups          beszel-hub:beszel-hub     0700
/etc/beszel                         root:root          0755
/etc/beszel/hub                     root:beszel-hub     0750
/etc/beszel/agent                   root:beszel-agent   0750
/etc/beszel/backup                  root:beszel-hub     0750
```

Install binaries `root:root 0755`, license/manifest `root:root 0644`. Refuse if the release directory already exists with different contents. Create `/srv/beszel/.current.0.18.8-c4924f01-ea964141` and `mv -Tf` it to `current`. Install unit files under `/etc/systemd/system` and call only `systemctl daemon-reload`.

- [ ] **Step 5: Create Hub unit**

Use these operational lines plus standard Unit/Install sections:

```ini
[Service]
Type=simple
User=beszel-hub
Group=beszel-hub
UMask=0077
EnvironmentFile=/etc/beszel/hub/hub.env
WorkingDirectory=/srv/beszel/shared/hub
ExecStart=/srv/beszel/current/beszel serve --http 127.0.0.1:8090
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
LockPersonality=true
MemoryDenyWriteExecute=true
ReadWritePaths=/srv/beszel/shared/hub
```

`After/Wants=network-online.target`. Do not use `DynamicUser` because the persistent data owner must remain stable across release/restore.

- [ ] **Step 6: Create Agent unit**

Use `After=network-online.target beszel-hub.service`, `Wants=network-online.target beszel-hub.service`; service body:

```ini
[Service]
Type=simple
User=beszel-agent
Group=beszel-agent
UMask=0077
EnvironmentFile=/etc/beszel/agent/agent.env
WorkingDirectory=/srv/beszel/shared/agent
ExecStart=/srv/beszel/current/beszel-agent
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictNamespaces=true
RestrictRealtime=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
LockPersonality=true
MemoryDenyWriteExecute=true
ReadWritePaths=/srv/beszel/shared/agent
```

Do not add `ProtectProc`/`ProcSubset` because CPU/process metrics need normal `/proc` reads. Do not grant Docker socket, block devices, capabilities or supplementary groups.

- [ ] **Step 7: Run static and shell gates**

Run:

```bash
cd ops-console
bash -n deploy/beszel/install-beszel.sh
npm test -- deploy/deployment-assets.test.ts
```

Expected: installer/unit assertions pass; backup assertions may remain red until Task 3.

- [ ] **Step 8: Commit installer and units**

```bash
git add ops-console/deploy/beszel/install-beszel.sh ops-console/deploy/beszel/hub.env.example ops-console/deploy/beszel/agent.env.example ops-console/deploy/systemd/beszel-hub.service ops-console/deploy/systemd/beszel-agent.service ops-console/deploy/deployment-assets.test.ts
git commit -m "build(ops): add hardened Beszel systemd install"
```

### Task 3: Implement encrypted backup and isolated restore rehearsal

**Files:**
- Create: `ops-console/deploy/beszel/backup.env.example`
- Create: `ops-console/deploy/beszel/backup-beszel.sh`
- Create: `ops-console/deploy/beszel/restore-beszel-drill.sh`
- Create: `ops-console/deploy/systemd/beszel-backup.service`
- Create: `ops-console/deploy/systemd/beszel-backup.timer`
- Modify: `ops-console/deploy/beszel/install-beszel.sh`
- Modify: `ops-console/deploy/deployment-assets.test.ts`

**Interfaces:**
- Backup creates `beszel-daily-YYYYMMDDTHHMMSSZ.tar.gz.age` plus `.sha256`, and Sunday also `beszel-weekly-...`; retains newest 7 daily and 4 weekly.
- Restore drill never writes under `/srv/beszel/shared/hub`.

- [ ] **Step 1: Add failing static backup tests**

Assert exact source files (`data.db`, `id_ed25519`, installed `version.env`, checksums), `sqlite3 .backup`, `PRAGMA integrity_check`, age, checksum verification, fixed output prefixes, no direct `cp data.db`, no broad `find -delete`, no `/srv/edutrack` paths.

- [ ] **Step 2: Add backup env example**

```dotenv
BESZEL_BACKUP_AGE_RECIPIENT=
```

This is a public age recipient, but keep the installed file `/etc/beszel/backup/backup.env` as `root:beszel-hub 0640` for consistent config handling. Do not source the EduTrack application `.env` because it contains unrelated secrets.

- [ ] **Step 3: Implement consistent encrypted backup**

The script uses fixed paths and checks commands `sqlite3 age sha256sum tar flock find sort`:

```bash
data_dir=/srv/beszel/shared/hub/beszel_data
backup_dir=/srv/beszel/shared/backups
manifest=/srv/beszel/current/version.env
db=${data_dir}/data.db
private_key=${data_dir}/id_ed25519
```

Create `work_dir=$(mktemp -d "${backup_dir}/.beszel-backup.XXXXXX")`, trap removal of only this directory, acquire `${backup_dir}/.backup.lock`, then:

```bash
sqlite3 "${db}" ".backup '${work_dir}/data.db'"
[[ $(sqlite3 "${work_dir}/data.db" 'PRAGMA integrity_check;') == ok ]]
install -m 0600 "${private_key}" "${work_dir}/id_ed25519"
install -m 0600 "${manifest}" "${work_dir}/version.env"
sha256sum "${work_dir}/data.db" "${work_dir}/id_ed25519" "${work_dir}/version.env" > "${work_dir}/contents.sha256"
tar -C "${work_dir}" -czf "${work_dir}/beszel.tar.gz" data.db id_ed25519 version.env contents.sha256
age --recipient "${BESZEL_BACKUP_AGE_RECIPIENT}" --output "${final}.tmp" "${work_dir}/beszel.tar.gz"
mv "${final}.tmp" "${final}"
```

Create checksum inside `backup_dir` with a relative filename and immediately verify `sha256sum -c`.

- [ ] **Step 4: Implement bounded daily/weekly retention**

On Sunday UTC, copy the already encrypted daily artifact/checksum to weekly names using mode `0600`, then verify weekly checksum. Implement a function that receives prefix and keep count, lists only regex-matching basenames under the fixed backup directory, sorts descending, and unlinks entries after the keep count one file at a time. Reject any basename containing `/` or not matching:

```text
^beszel-(daily|weekly)-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.age(\.sha256)?$
```

Keep artifacts and sidecars as pairs. Do not use a glob-expanded `rm` or recursive deletion.

- [ ] **Step 5: Implement isolated restore drill**

Usage example is `restore-beszel-drill.sh /srv/beszel/shared/backups/beszel-daily-20260824T034500Z.tar.gz.age /secure/age-identity.txt`. Resolve both arguments with `realpath`, verify they are regular files, verify adjacent sidecar, create `/tmp/edutrack-beszel-restore.XXXXXX`, decrypt, assert tar entries equal the four expected relative filenames, extract, verify `contents.sha256`, run SQLite integrity check and assert nonempty Ed25519 key plus matching `BESZEL_VERSION=0.18.8`. Print only temp result path and integrity result; never print key or database contents. Trap removes temp output unless `BESZEL_RESTORE_KEEP=true` is explicitly set.

- [ ] **Step 6: Create backup service/timer**

Service:

```ini
[Unit]
Description=Beszel encrypted backup
After=beszel-hub.service edutrack-ops-backup.service

[Service]
Type=oneshot
User=beszel-hub
Group=beszel-hub
UMask=0077
EnvironmentFile=/etc/beszel/backup/backup.env
ExecStart=/usr/local/libexec/edutrack-backup-beszel
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/beszel/shared/backups
ReadOnlyPaths=/srv/beszel/shared/hub /srv/beszel/current
CapabilityBoundingSet=
```

Timer uses `OnCalendar=*-*-* 03:45:00`, `Persistent=true`, `RandomizedDelaySec=5m` and targets `beszel-backup.service`.

Modify installer to install both scripts under `/usr/local/libexec` as `root:root 0755` and install backup units, still without starting/enabling.

- [ ] **Step 7: Run all deployment gates**

Run:

```bash
cd ops-console
bash -n deploy/beszel/install-beszel.sh deploy/beszel/backup-beszel.sh deploy/beszel/restore-beszel-drill.sh
npm test -- deploy/deployment-assets.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit backup/restore assets**

```bash
git add ops-console/deploy/beszel ops-console/deploy/systemd/beszel-backup.service ops-console/deploy/systemd/beszel-backup.timer ops-console/deploy/deployment-assets.test.ts
git commit -m "build(ops): back up Beszel data safely"
```

### Task 4: Add a redacted production contract smoke command

**Files:**
- Create: `ops-console/src/cli/smoke-beszel.ts`
- Create: `ops-console/src/cli/smoke-beszel.test.ts`
- Modify: `ops-console/scripts/build-server.mjs`
- Modify: `ops-console/deploy/release-ops.sh`
- Modify: `ops-console/deploy/deployment-assets.test.ts`

**Interfaces:**
- Consumes: enabled `CollectorConfig`, `createBeszelClient`, `normalizeBeszelSnapshot` from the backend plan.
- Produces: `smokeBeszelContract(config, reader?, now?): Promise<BeszelSmokeResult>` and executable `dist/server/smoke-beszel.js`.

```ts
export interface BeszelSmokeResult {
  hubVersion: '0.18.8';
  systemStatus: 'up' | 'down' | 'paused' | 'pending';
  agentVersion: string;
  metricAgeSeconds: number;
  serviceCount: number;
}
```

- [ ] **Step 1: Write failing safe-output tests**

Inject a fake `BeszelSnapshotReader` returning fixtures plus `host`, `name`, token-like text and service names. Assert the function returns only the five fields above and serialized output contains none of those injected values, telemetry email, system ID, `key`, `token`, `password`, `host`, `services` or raw `stats`.

Also assert disabled config throws `beszel_smoke_requires_enabled_config` and stale/invalid snapshot uses the same bounded adapter errors without printing raw data.

- [ ] **Step 2: Run smoke test and confirm RED**

Run: `cd ops-console && npm test -- src/cli/smoke-beszel.test.ts`

Expected: FAIL because CLI is absent.

- [ ] **Step 3: Implement the smoke function and executable guard**

```ts
export async function smokeBeszelContract(
  config: CollectorConfig,
  reader?: BeszelSnapshotReader,
  now = new Date(),
): Promise<BeszelSmokeResult> {
  if (!config.beszel.enabled) throw new Error('beszel_smoke_requires_enabled_config');
  const raw = await (reader ?? createBeszelClient(config.beszel)).readSnapshot();
  const normalized = normalizeBeszelSnapshot(raw, now);
  return {
    hubVersion: normalized.hubVersion,
    systemStatus: normalized.systemStatus,
    agentVersion: normalized.agentVersion,
    metricAgeSeconds: Math.max(0, Math.floor((now.getTime() - Date.parse(normalized.metricObservedAt)) / 1000)),
    serviceCount: normalized.matchedTotal,
  };
}
```

Under the executable guard, load collector config, call the function and write exactly one JSON line to stdout. On error, write only a bounded error code to stderr and set exit code 1.

- [ ] **Step 4: Build and require the artifact**

Add `'smoke-beszel': 'src/cli/smoke-beszel.ts'` to esbuild entry points. Add `dist/server/smoke-beszel.js` to `release-ops.sh` required files and deployment asset tests.

- [ ] **Step 5: Run unit/build/static gates**

Run:

```bash
cd ops-console
npm test -- src/cli/smoke-beszel.test.ts deploy/deployment-assets.test.ts
npm run typecheck
npm run build:server
test -f dist/server/smoke-beszel.js
```

Expected: PASS.

- [ ] **Step 6: Commit smoke command**

```bash
git add ops-console/src/cli/smoke-beszel.ts ops-console/src/cli/smoke-beszel.test.ts ops-console/scripts/build-server.mjs ops-console/deploy/release-ops.sh ops-console/deploy/deployment-assets.test.ts
git commit -m "build(ops): add redacted Beszel contract smoke"
```

### Task 5: Update Ops configuration and write the operator runbook

**Files:**
- Modify: `ops-console/deploy/collector.env.example`
- Modify: `ops-console/deploy/README.md`
- Modify: `ops-console/deploy/release-checklist.md`
- Create: `docs/runbooks/beszel-telemetry-rollout.md`
- Modify: `ops-console/deploy/deployment-assets.test.ts`

**Interfaces:**
- Produces exact provision/pilot/enable/rollback commands and evidence fields.

- [ ] **Step 1: Add feature flag example with no credential**

Append:

```dotenv
OPS_BESZEL_ENABLED=false
OPS_BESZEL_URL=http://127.0.0.1:8090
OPS_BESZEL_USER=ops-telemetry@thienuy.invalid
OPS_BESZEL_PASSWORD_FILE=/etc/edutrack-ops/beszel-password
OPS_BESZEL_SYSTEM_ID=
OPS_BESZEL_TIMEOUT_MS=5000
```

The example must not contain a password/token/system ID value.

- [ ] **Step 2: Add preflight and install runbook section**

The runbook starts with:

```bash
cd /home/deploy/edutrack-app-ops-migration/ops-console
npm ci
npm test
npm run typecheck
npm run build
npm run test:e2e -- e2e/ops-console.spec.ts
sha256sum deploy/beszel/version.env dist/server/collector-main.js dist/web/index.html
sudo ss -H -ltnp | rg ':(8090|45876)\b' || true
sudo systemctl --failed
```

Before copying artifacts to the VPS, download both exact release archives on the trusted operator workstation and run:

```bash
gh attestation verify beszel_linux_amd64.tar.gz --repo henrygd/beszel
gh attestation verify beszel-agent_linux_amd64.tar.gz --repo henrygd/beszel
sha256sum beszel_linux_amd64.tar.gz beszel-agent_linux_amd64.tar.gz
```

The hashes must equal the manifest exactly and both attestations must verify; otherwise stop. The host preflight also stops if either port is occupied or any unexplained failed unit exists. Install with `sudo bash deploy/beszel/install-beszel.sh`, copy env examples via `install` to prepared temp files, verify ownership/modes, then start Hub only.

- [ ] **Step 3: Add SSH-tunnel provisioning section**

Open from the operator workstation:

```bash
ssh -N -L 18090:127.0.0.1:8090 deploy@man.thienuy.edu.vn
```

At `http://127.0.0.1:18090`, create the initial superuser, regular user `ops-telemetry@thienuy.invalid` with role `readonly`, add one system using WebSocket, and share only that system with the readonly user. Generate the telemetry password directly into `/etc/edutrack-ops/beszel-password` with `umask 077` and at least 48 random bytes, then set the same value in the Hub UI without recording it in the runbook evidence.

Copy the Hub public key and one-time system token into `/etc/beszel/agent/key.pub` and `/etc/beszel/agent/token`; set `root:beszel-agent 0640`. Record only file SHA-256, not contents.

- [ ] **Step 4: Add Agent and network verification section**

```bash
sudo systemctl enable --now beszel-hub.service beszel-agent.service
curl --fail --silent --show-error http://127.0.0.1:8090/api/health
sudo ss -H -ltnp 'sport = :8090'
sudo ss -H -ltnp 'sport = :45876'
sudo systemctl show beszel-hub beszel-agent -p User -p Group -p MainPID -p MemoryCurrent -p CPUUsageNSec
sudo journalctl -u beszel-hub -u beszel-agent --since '-10 minutes' --no-pager | rg -v 'token|password|Authorization'
```

Expected: one `127.0.0.1:8090` listener, zero `45876` listeners, services active under their own users. Journal evidence must not include any credential; if it does, stop and rotate affected secrets.

- [ ] **Step 5: Add application release and disabled smoke section**

Deploy the already verified Ops build using existing `release-ops.sh` with `OPS_BESZEL_ENABLED=false`. Verify login/TOTP, `/api/overview`, existing monitors and Zalo remain unchanged. Do not modify Nginx.

- [ ] **Step 6: Add release checklist gates**

Extend checklist with exact evidence for artifact hashes, unit users, loopback/no-45876, readonly user/system share, contract smoke, pilot CPU/RSS, dashboard ranges, incident/recovery, encrypted backup/restore and rollback target. Keep the statement that the checklist does not authorize cutover by itself.

- [ ] **Step 7: Test docs/assets and commit**

Run: `cd ops-console && npm test -- deploy/deployment-assets.test.ts && git diff --check`

Expected: PASS.

```bash
git add ops-console/deploy/collector.env.example ops-console/deploy/README.md ops-console/deploy/release-checklist.md ops-console/deploy/deployment-assets.test.ts docs/runbooks/beszel-telemetry-rollout.md
git commit -m "docs(ops): add Beszel rollout runbook"
```

### Task 6: Run staging contract and 30-minute resource pilot

**Files:**
- Create evidence outside git in the approved release record location; do not commit credentials or raw Hub responses.

**Interfaces:**
- Produces a go/no-go decision before `OPS_BESZEL_ENABLED=true`.

- [ ] **Step 1: Verify readonly API contract through loopback**

Run the repository's fake-server contract tests first. Then execute `node dist/server/smoke-beszel.js` from the released Ops directory with the production collector environment. It authenticates using the configured password file and prints only:

```json
{"hubVersion":"0.18.8","systemStatus":"up","agentVersion":"0.18.8","metricAgeSeconds":0,"serviceCount":0}
```

The smoke command must omit token, key, email, system ID, hostname, raw records and service names. Save only this safe aggregate and the process exit status.

- [ ] **Step 2: Capture pilot start counters**

Record UTC time, `CPUUsageNSec` and `MemoryCurrent` for Hub/Agent plus EduTrack health latency:

```bash
date -u --iso-8601=seconds
sudo systemctl show beszel-hub.service beszel-agent.service -p CPUUsageNSec -p MemoryCurrent -p MainPID
curl --fail --silent --show-error --output /dev/null --write-out 'liveness_seconds=%{time_total}\n' http://127.0.0.1:3000/api/v1/liveness
curl --fail --silent --show-error --output /dev/null --write-out 'health_seconds=%{time_total}\n' http://127.0.0.1:3000/api/v1/health
```

- [ ] **Step 3: Observe for at least 30 minutes without blocking a shell sleep**

Leave feature flag false. Use the environment's recurring wait/monitor mechanism and sample every five minutes: Hub/Agent active state, combined RSS, CPU counters, EduTrack liveness/health latency, PostgreSQL monitor and disk free space. Do not use a single blocking `sleep 1800`.

- [ ] **Step 4: Calculate pilot budget and decide**

At or after 30 minutes, compute:

```text
combinedRSS = hub.MemoryCurrent + agent.MemoryCurrent
idleCpuPercent = 100 * (hubCpuDeltaNs + agentCpuDeltaNs) / elapsedNs
```

Go only if combined RSS is `<=209715200` bytes, idle CPU average `<=2.0%`, both services stayed active, metrics age stayed under 120 seconds, disk did not regress materially, and EduTrack health/latency remained within the recorded baseline. Any failure is a no-go; disable/stop Beszel and investigate without enabling Ops adapter.

- [ ] **Step 5: Retain sanitized pilot evidence**

Store timestamps, aggregate numbers, release hashes and go/no-go only. Remove PIDs if evidence is shared; never retain user ID, token, system ID, hostname or raw JSON.

### Task 7: Enable Ops integration in the approved window

**Files:**
- Production `/etc/edutrack-ops/collector.env` only; no repository edit.

**Interfaces:**
- Activates the already deployed feature and validates incidents/history/backups.

- [ ] **Step 1: Create atomic rollback inputs**

Record current `/srv/edutrack-ops/current` symlink and copy collector env to a root-only timestamped file under `/etc/edutrack-ops/rollback/`. Back up Ops SQLite using its existing backup mechanism. Do not touch EduTrack/PostgreSQL/Nginx.

- [ ] **Step 2: Atomically install enabled collector config**

Create a root-owned, `edutrack-ops` group-readable mode-`0640` temporary config beside `/etc/edutrack-ops/collector.env`, change only `OPS_BESZEL_ENABLED` from `false` to `true` and replace the empty `OPS_BESZEL_SYSTEM_ID` value with the exact 15-character ID shown by the provisioned Hub system. Validate the ID with `^[a-z0-9]{15}$` before installing the file.

```dotenv
OPS_BESZEL_ENABLED=true
```

Validate by executing `node dist/server/smoke-beszel.js` as `deploy` with the prepared environment; then `install -o root -g edutrack-ops -m 0640` the prepared file.

- [ ] **Step 3: Restart only Ops services**

```bash
sudo systemctl restart edutrack-ops-collector.service edutrack-ops-web.service
sudo systemctl is-active edutrack-ops-collector.service edutrack-ops-web.service beszel-hub.service beszel-agent.service
```

Expected: all active. Do not include PM2/PostgreSQL/Nginx in the command.

- [ ] **Step 4: Validate first two minutes**

Through authenticated `https://man.thienuy.edu.vn`, verify the three new monitors, current CPU/RAM/disk/load/network, service projection and default `24h` history. Query each range and confirm UTC resolution and no more than 720 points. Stop if current telemetry is older than 150 seconds or browser devtools shows any request to port 8090/PocketBase.

- [ ] **Step 5: Validate incident/recovery safely**

Use the tested fake/fixture injection path against an isolated Ops SQLite copy, or briefly stop only `beszel-agent` if the maintenance window explicitly permits it. Two consecutive minute probes must open exactly one `beszel` incident/Zalo; restart Agent, then two healthy probes must produce exactly one recovery. Never induce load/disk pressure on the host.

- [ ] **Step 6: Enable and test Beszel backup timer**

```bash
sudo systemctl enable --now beszel-backup.timer
sudo systemctl start beszel-backup.service
sudo systemctl status beszel-backup.service beszel-backup.timer --no-pager
sudo -u beszel-hub sha256sum -c /srv/beszel/shared/backups/beszel-daily-*.tar.gz.age.sha256
```

Resolve the newest explicit checksum path before running verification; do not pass a broad unresolved glob to a deletion command. Run restore drill with the approved age identity into temp and verify `PRAGMA integrity_check=ok`.

- [ ] **Step 7: Sign off completion criteria**

Record release commit, artifact hashes, old/new Ops symlink, unit states, listener output, pilot budget, dashboard screenshots without identifiers, alert/recovery IDs, backup checksum and restore result. Explicitly record the same-host outage limitation.

### Task 8: Rehearse and document rollback

**Files:**
- Modify documentation only if rehearsal finds an inaccurate command or missing safety check.

**Interfaces:**
- Produces a verified rollback that leaves data available for diagnosis.

- [ ] **Step 1: Disable adapter first**

Restore the saved collector env or atomically set `OPS_BESZEL_ENABLED=false`; restart only collector. Verify all legacy monitors continue and `/api/overview` remains authenticated.

- [ ] **Step 2: Roll back Ops release if required**

Atomically restore the recorded prior `/srv/edutrack-ops/current` symlink and restart only Ops web/collector. No database downgrade is needed because no new table exists.

- [ ] **Step 3: Stop Beszel without deleting data**

```bash
sudo systemctl disable --now beszel-backup.timer beszel-agent.service beszel-hub.service
sudo systemctl reset-failed beszel-agent.service beszel-hub.service
```

Do not delete `/srv/beszel/shared`, `/etc/beszel`, `/etc/edutrack-ops/beszel-password`, release directories or backups during emergency rollback.

- [ ] **Step 4: Verify unaffected services**

Check EduTrack liveness/health, PM2 status, PostgreSQL connectivity, Ops login/TOTP, legacy samples and Zalo. Compare before/after PIDs for PM2/PostgreSQL/Nginx to prove they were not restarted.

- [ ] **Step 5: Correct docs if rehearsal exposed a gap**

Run docs/static tests, commit only the runbook/checklist corrections:

```bash
cd ops-console
npm test -- deploy/deployment-assets.test.ts
git diff --check
git add deploy/README.md deploy/release-checklist.md ../docs/runbooks/beszel-telemetry-rollout.md
git commit -m "docs(ops): verify Beszel rollback rehearsal"
```

If commands were already exact, do not create an empty commit.

---

## Host rollout completion signal

The plan is complete only when exact release hashes verify, Hub is loopback-only, Agent has no SSH listener, both run unprivileged, readonly API contract passes, 30-minute resource budget passes, Ops feature produces telemetry/history/one deduped alert and recovery, encrypted backup plus isolated restore pass, and rollback proves EduTrack/PM2/PostgreSQL/Nginx were untouched.
