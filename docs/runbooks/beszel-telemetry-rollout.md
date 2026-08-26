# Beszel telemetry rollout runbook

This runbook is an operator procedure, not production authorization. Beszel v0.18.8 is pinned to the manifest in `ops-console/deploy/beszel/version.env`; use an approved maintenance window and record operator sign-off before any service start or collector enablement. During rollout and rollback, do not restart PM2, PostgreSQL or Nginx.

## 1. Preflight and repository gates

Run on the trusted operator workstation:

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

The Playwright gate must run with the required browser libraries installed. If it cannot launch, record the environment blocker and do not call the E2E gate green.

Download the exact release archives on the trusted workstation; never use `latest`, `main`, an upstream installer or an update command:

```bash
gh release verify-asset v0.18.8 beszel_linux_amd64.tar.gz --repo henrygd/beszel
gh release verify-asset v0.18.8 beszel-agent_linux_amd64.tar.gz --repo henrygd/beszel
sha256sum beszel_linux_amd64.tar.gz beszel-agent_linux_amd64.tar.gz
```

Both attestations must verify and the hashes must match the manifest. Otherwise stop.

## 2. Install pinned Beszel assets

Copy the verified release worktree to the host without copying secrets, then run:

```bash
sudo bash deploy/beszel/install-beszel.sh
```

The installer is root-only, x86_64-only, verifies SHA-256 and archive contents, creates `/srv/beszel/current` atomically and installs hardened units. It does not start or enable any service. Prepare the env files from the examples with `install`, verify ownership and modes, and keep credentials out of shell history.

Hub must use `APP_URL=http://127.0.0.1:8090`, with `USER_CREATION=false`, `CHECK_UPDATES=false` and `CONTAINER_DETAILS=false`. Agent must use `HUB_URL=http://127.0.0.1:8090`, `DISABLE_SSH=true`, empty Docker/GPU/SMART settings and the allowlist `nginx*,postgresql*,edutrack-ops-*,pm2-*`.

## 3. Provision through an SSH tunnel

Open the Hub UI only through a local forward from the operator workstation:

```bash
ssh -N -L 18090:127.0.0.1:8090 deploy@man.thienuy.edu.vn
```

At `http://127.0.0.1:18090`, create the initial superuser, regular user `ops-telemetry@thienuy.invalid` with role `readonly`, one VPS system over WebSocket, and share only that system with the readonly user. Do not publish the Hub UI through Nginx.

Generate the telemetry password directly into `/etc/edutrack-ops/beszel-password` using `umask 077` and at least 48 random bytes. Set the same value in the Hub UI without recording it in evidence. Copy the Hub public key and one-time Agent system token into `/etc/beszel/agent/key.pub` and `/etc/beszel/agent/token`; set `root:beszel-agent` ownership and mode `0640`. Record file SHA-256 only.

## 4. Start and verify Hub/Agent

Only after the approved gate:

```bash
sudo systemctl start beszel-hub.service
sudo systemctl start beszel-agent.service
curl --fail --silent --show-error http://127.0.0.1:8090/api/health
sudo ss -H -ltnp 'sport = :8090'
sudo ss -H -ltnp 'sport = :45876'
sudo systemctl show beszel-hub beszel-agent -p User -p Group -p MainPID -p MemoryCurrent -p CPUUsageNSec
sudo journalctl -u beszel-hub -u beszel-agent --since '-10 minutes' --no-pager | rg -v 'token|password|Authorization'
```

Expected: one loopback `8090` listener, zero `45876` listeners, and separate unprivileged users. If a journal contains a credential, stop and rotate the affected secret.

## 5. Deploy disabled Ops integration and pilot

Use the already verified Ops build and existing `release-ops.sh` with `OPS_BESZEL_ENABLED=false`. Verify login/TOTP, `/api/overview`, all legacy monitors and Zalo remain unchanged. Do not modify Nginx or EduTrack PM2/PostgreSQL.

Run the redacted smoke command from the released Ops directory with the prepared collector environment:

```bash
node dist/server/smoke-beszel.js
```

Save only its five-field aggregate JSON and exit status. Capture UTC start time, unit CPU/RSS and EduTrack liveness/health latency. Observe for at least 30 minutes using five-minute samples; do not block a shell with one long sleep. Go only when both units remain active, combined RSS is `<=209715200`, idle CPU average is `<=2.0%`, metric age stays under 120 seconds, disk is stable and EduTrack remains within baseline.

## 6. Enable in the approved window

Save the current `/srv/edutrack-ops/current` symlink, collector env and Ops SQLite backup under root-only rollback paths. Prepare a temporary collector config beside the installed file; change only the feature flag and provisioned 15-character lowercase system ID, validate `^[a-z0-9]{15}$`, smoke-test it, then install with `root:edutrack-ops` mode `0640`.

```dotenv
OPS_BESZEL_ENABLED=true
```

Restart only the affected Ops services:

```bash
sudo systemctl restart edutrack-ops-collector.service edutrack-ops-web.service
sudo systemctl is-active edutrack-ops-collector.service edutrack-ops-web.service beszel-hub.service beszel-agent.service
```

Within two minutes verify the three new monitors, current CPU/RAM/disk/load/network cards, failed-first services and default `24h` history. Query `1h`, `24h`, `7d` and `30d`; confirm fixed UTC resolution and at most 720 points. Verify the browser made no request to port 8090 or PocketBase. Test incidents/recovery only through an isolated fixture or explicitly approved Agent stop; never induce host load.

Enable and verify encrypted backups:

```bash
sudo systemctl enable --now beszel-backup.timer
sudo systemctl start beszel-backup.service
sudo systemctl status beszel-backup.service beszel-backup.timer --no-pager
```

Resolve the newest explicit checksum path before `sha256sum -c`, then run the restore drill with the approved age identity into a temporary directory and verify `PRAGMA integrity_check=ok`.

## 7. Rollback

First restore the saved collector env or atomically set `OPS_BESZEL_ENABLED=false`, then restart only `edutrack-ops-collector.service`. If needed, restore the prior Ops `current` symlink and restart only Ops web/collector. No database downgrade is needed.

Stop Beszel without deleting data:

```bash
sudo systemctl disable --now beszel-backup.timer beszel-agent.service beszel-hub.service
sudo systemctl reset-failed beszel-agent.service beszel-hub.service
```

Do not delete `/srv/beszel/shared`, `/etc/beszel`, the Ops Beszel password file, release directories or backups. Verify EduTrack liveness/health, PM2, PostgreSQL, Nginx, Ops login/TOTP, legacy samples and Zalo, and compare before/after PM2/PostgreSQL/Nginx PIDs.

## Evidence and completion

Record UTC timestamps, operator, commit, release hashes/attestations, unit state/listeners, sanitized smoke JSON, pilot aggregates, dashboard/range checks, deduped alert/recovery IDs, backup checksum/restore result and rollback target. Do not retain credentials, raw Hub responses, hostname, user ID, token, key or system ID. The same-host outage limitation remains: Hub cannot alert when the entire VPS is down; external dead-man monitoring is separate.
