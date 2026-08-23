# EduTrack Ops Console deployment

This package is an independent, read-only operations console. Provision its secret files outside git, then run the release script as root with a verified build directory. The release script owns only `/srv/edutrack-ops`; it does not restart or rewrite the EduTrack application.

Required secret files are `/etc/edutrack-ops/web.env` and `/etc/edutrack-ops/collector.env`, owned by `root:edutrack-ops` with mode `0640`. `OPS_DATA_KEY` must be a fresh 32-byte base64 key. Production collector configuration must contain a PostgreSQL monitor URL, bot token and a non-empty approved `OPS_ALERT_ZALO_RECIPIENT_UIDS` allowlist.

Install the unit files under `/etc/systemd/system/`, enable `edutrack-ops-web.service`, `edutrack-ops-collector.service` and `edutrack-ops-backup.timer`, then run `systemctl daemon-reload`. Provision the aggregate PostgreSQL function with `provision-postgres-monitor.sh` using a mode-0600 password file.

For the host, first run `deploy/nginx/activate-host.sh man.thienuy.edu.vn` as root. It validates the bootstrap vhost before requesting the certificate, validates the TLS vhost before the final reload, and restores the previous vhost on failure. Verify HTTPS SNI, authentication, a loopback collector sample and synthetic Zalo alert/recovery before declaring release.

Rollback is the reversible operation of restoring the prior `/srv/edutrack-ops/current` symlink, stopping/restarting only the two Ops services and restoring the prior Nginx vhost. Do not restart PM2, PostgreSQL or the EduTrack service as part of this workflow.
