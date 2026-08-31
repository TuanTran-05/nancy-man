# Ops Console canonical-auth cutover

This runbook is a change-window procedure for moving `man.thienuy.edu.vn` to the
PostgreSQL-backed canonical Ops sessions. It does not authorize a production
change by itself. The owner, database backup, rollback owner, and maintenance
window must be recorded before starting.

## Preconditions

1. Build and attest a release. Run the repository verification gate, review the
   release manifest, and confirm the API and web services have the same
   `ops-legacy-monitoring-hmac` credential without putting its value in an env
   file.
2. Confirm PostgreSQL migrations are applied by the dedicated
   `edutrack-ops-migrate.service`; the API must not run migrations at startup.
3. Back up the canonical PostgreSQL database and the legacy SQLite file and
   verify both backup artifacts before the switch.
4. Confirm the web service can read the SQLite file and the API cannot. Keep the
   SQLite file available as read-only transition data; do not delete it during
   this cutover.

## Identity and enrollment

1. Bootstrap the canonical owner `tuan.dev` using the approved one-time
   bootstrap path. Set a fresh password of at least 14 characters and enroll a
   fresh TOTP factor. Do not reuse the legacy password, TOTP secret, session,
   cookie, or enrollment token.
2. Log in as `tuan.dev` through `POST /api/v1/auth/login`, complete
   `POST /api/v1/auth/login/totp`, and verify `GET /api/v1/auth/session` returns
   only the canonical principal and CSRF token fields.
3. From the owner Users workspace, create `ops-admin` with the default
   Maintainer role. Deliver the one-time full enrollment link out of band,
   complete its password and TOTP enrollment, and verify that the link cannot be
   used twice and expires after 24 hours.
4. After both canonical users are active, run the explicit Zalo principal
   cutover. Substitute only the two PostgreSQL UUIDs; the command prints counts,
   never secrets or chat values:

   ```bash
   node scripts/ops/cutover-zalo-principals.mjs \
     --database /srv/edutrack-ops/shared/ops.sqlite \
     --tuan-dev-principal-id <tuan.dev-postgres-uuid> \
     --ops-admin-principal-id <ops-admin-postgres-uuid>
   ```

   The command requires exactly `tuan.dev` and `ops-admin`, rewrites all three
   Zalo tables in one transaction, and fails closed if any reference is
   unmapped. Keep the legacy SQLite file read-only after this command.

## Smoke test before switching Nginx

Using fresh browser state, verify:

- canonical login, session restore, logout, and CSRF-protected account mutation;
- owner-only Users list/create/lock/recover/revoke controls;
- `/api/v1/monitoring/overview` and infrastructure history;
- incident acknowledgement carries the canonical `userId` into the audit row;
- `/api/v1/zalo/link`, link-code creation, and unlink;
- the exact unauthenticated `POST /api/zalo-bot/webhook` route still reaches
  the web plane and rejects a bad bot secret.

Verify that an old `__Host-ops_session` cookie sent to canonical endpoints is
rejected with `401`, and that `GET /api/session` and other legacy browser API
paths return `410`. Verify there is no public generic `/api/` proxy.

## Switch

1. Run the migration unit and health checks.
2. Install the attested release with `prepare-release.sh` and run
   `activate-release.sh` so systemd units and Nginx are preflighted before the
   pointer changes.
3. Reload Nginx, then verify the public route ownership: `/api/v1/**` goes to
   `127.0.0.1:3100`, `/` and the exact webhook go to `127.0.0.1:3101`, and
   `/api/session` is `410`.
4. Repeat the smoke test using a new browser context. Never copy session rows or
   session cookies between planes.

## Rollback

If the smoke test fails, stop the change and use the release activation rollback
to restore the previous release and Nginx configuration. Restore the previous
systemd unit set, reload Nginx, and verify the old release health endpoint.

Do not copy sessions, cookies, MFA secrets, or password material between the
old and canonical planes. Preserve the PostgreSQL backup and the SQLite backup;
keep SQLite read-only for the transition. A later deletion of legacy auth or
SQLite data requires a separate approved change and backup-retention decision.
