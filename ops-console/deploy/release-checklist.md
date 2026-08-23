# Ops Console release checklist

Complete and sign each gate in order. Production cutover requires an approved maintenance window; this document does not authorize a release by itself.

1. [ ] Task 1–8 application, typecheck, unit, build, static deployment and shell syntax gates are green; record commit and artifact digest.
2. [ ] Run `systemctl --failed`, investigate every unit, and resolve the existing `logrotate.service` failure before proceeding.
3. [ ] Provision `/etc/edutrack-ops/{web,collector}.env`, fresh `OPS_DATA_KEY` and `OPS_ZALO_RECIPIENT_KEY`, PostgreSQL URL, the separate Ops Zalo token and webhook/link secrets outside git; verify modes and ownership.
4. [ ] Back up `/srv/edutrack-ops/shared` and record the prior `current` symlink for rollback.
5. [ ] Dry-run PostgreSQL role/function inspection; verify `ops_monitor` can execute only `ops_metrics.snapshot()`, cannot create/DML, has no public table read capability and is not an elevated role.
6. [ ] Install/enable the two Ops services and backup timer; verify systemd hardening, loopback web binding and independent collector restart behavior.
7. [ ] Install the Nginx bootstrap vhost and verify `nginx -t`; verify HTTP ACME challenge access, then run Certbot issuance for `man.thienuy.edu.vn`.
8. [ ] Install the TLS vhost, verify `nginx -t`, reload, and perform authenticated HTTPS SNI/protocol/certificate checks.
9. [ ] Verify liveness, health, process, PostgreSQL, cron and backup samples; verify stale dashboard state when collector is stopped.
10. [ ] In the authenticated console create a one-time link code, send `/link CODE` to the separate Ops bot in a private chat, verify the linked state, then send a synthetic critical event and two healthy samples; verify exactly one linked-recipient Zalo critical alert and one recovery message with no PII, secret or excerpt.
11. [ ] Run `certbot renew --dry-run` and retain the output with the release record.
12. [ ] If any gate fails, atomically restore the prior Ops `current` symlink, reload the prior Nginx vhost and stop/restart only the Ops services. Do not restart PM2, PostgreSQL or the EduTrack service.

Required evidence: command output, timestamp, operator, artifact digest, recipient approval reference and rollback target.
