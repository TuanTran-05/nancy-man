# EduTrack Ops Console deployment

This package is an independent, read-only operations console. Provision its secret files outside git, then run the release script as root with a verified build directory. The release script owns only `/srv/edutrack-ops`; it does not restart or rewrite the EduTrack application.

Required secret files are `/etc/edutrack-ops/web.env` and `/etc/edutrack-ops/collector.env`, owned by `root:edutrack-ops` with mode `0640`. `OPS_DATA_KEY` and `OPS_ZALO_RECIPIENT_KEY` must be fresh 32-byte base64 keys. The Ops bot is separate from the EduTrack webapp bot: configure its token in both files, configure the webhook/link secrets in `web.env`, then link the operator's private Zalo chat from the authenticated console. The collector reads only active Ops links from the shared SQLite database; the old `OPS_ALERT_ZALO_RECIPIENT_UIDS` variable is an optional migration fallback.

Install the unit files under `/etc/systemd/system/`, enable `edutrack-ops-web.service`, `edutrack-ops-collector.service` and `edutrack-ops-backup.timer`, then run `systemctl daemon-reload`. Provision the aggregate PostgreSQL function with `provision-postgres-monitor.sh` using a mode-0600 password file.

For the host, first run `deploy/nginx/activate-host.sh man.thienuy.edu.vn` as root. It validates the bootstrap vhost before requesting the certificate, validates the TLS vhost before the final reload, and restores the previous vhost on failure. Configure the separate bot webhook to `https://man.thienuy.edu.vn/api/zalo-bot/webhook` with the `X-Bot-Api-Secret-Token` header, then verify HTTPS SNI, authentication, a loopback collector sample and synthetic Zalo alert/recovery before declaring release.

Use `deploy/release-checklist.md` as the ordered sign-off record. The local E2E fixture is repeatable with `npm run build && npm run test:e2e -- e2e/ops-console.spec.ts`; a production run additionally requires the approved cutover window and external secret/recipient provisioning.

Rollback is the reversible operation of restoring the prior `/srv/edutrack-ops/current` symlink, stopping/restarting only the two Ops services and restoring the prior Nginx vhost. Do not restart PM2, PostgreSQL or the EduTrack service as part of this workflow.

## Beszel telemetry rollout

Beszel is an optional, loopback-only telemetry dependency. Keep `OPS_BESZEL_ENABLED=false` until the approved pilot and cutover gates in [`../../docs/runbooks/beszel-telemetry-rollout.md`](../../docs/runbooks/beszel-telemetry-rollout.md) are complete. The repository plan and this checklist do not authorize production activation.

The installer is deliberately non-activating: it verifies the pinned `v0.18.8` artifacts, creates immutable release data and installs units, but calls only `systemctl daemon-reload`. Prepare `/etc/beszel/{hub,agent,backup}` env files separately, then start services only during the signed-off maintenance window.

Before enabling the collector, run the redacted contract smoke from the released directory:

```bash
node dist/server/smoke-beszel.js
```

The command emits only Hub version, system status, Agent version, metric age and matched service count. It must not be used to print or capture credentials, system IDs or raw Beszel records.

Beszel backups are independent from EduTrack backups. `beszel-backup.timer` writes encrypted, checksummed daily/weekly artifacts under `/srv/beszel/shared/backups`; use `restore-beszel-drill.sh` for an isolated integrity rehearsal and never restore directly over Hub data during rollback.
