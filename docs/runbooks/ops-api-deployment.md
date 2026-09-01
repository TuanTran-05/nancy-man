# Ops API collector deployment

This runbook deploys only the self-hosted collector API. Do not point
`man.thienuy.edu.vn` at this vhost as the final Operations UI: the authenticated
web console is deployed in a later phase.

## Preconditions

- Use the separate Ops host, not the user-app or production PostgreSQL host.
- Install Node.js 22, PostgreSQL client TLS material, Nginx, and systemd.
- Create the `edutrack-ops` system user and
  `/var/lib/edutrack-ops/object-store` owned by that user with mode `0700`.
- Stage a built repository at `/srv/edutrack-ops/current`; run
  `npm run build --workspace=@edutrack-ops/api` before activating it.
- Keep `OPS_SQL_WORKER_ENABLED=false` and all SQL feature flags false. The private
  SQL worker may be installed, but it must not receive a production database
  credential or enable reads yet.
- Do not place a database URL, HMAC key, session pepper, or browser-context key
  in Git or `/etc/edutrack-ops/api.env`.

## Install configuration and credentials

1. Copy `deploy/ops/env/api.env.example` to `/etc/edutrack-ops/api.env`, set
   the real browser origin list, and keep it mode `0640`, owned by root.
2. Create the six credential source files named in
   `deploy/ops/systemd/edutrack-ops-api.service` under
   `/etc/edutrack-ops/credentials/`; each must be a regular file, mode `0400`,
   containing one nonempty value. systemd copies them into `%d` for the service;
   the API rejects symbolic links or group/world-readable credential files.
   Before enabling the read-only Config Agent, apply the dedicated-group source
   permissions in `ops-config-agent-readonly.md`; systemd's private credential
   copies remain `root:root 0440` inside the API service regardless of the source
   file group.
3. Install the API, processor, notifier, migration, and SQL-worker systemd units, run `systemctl daemon-reload`, then use the
   explicit one-shot migration command once: `systemctl start` is **not** a
   migration. Run `systemctl start edutrack-ops-migrate.service` and inspect
   its journal before starting `edutrack-ops-api.service`.
4. Install the Nginx template, replace only `REPLACE_WITH_CERT_NAME`, validate
   with `nginx -t`, and reload Nginx. Confirm the Node port has no public
   firewall rule: only Nginx reaches `127.0.0.1:3100`.

## Enabling the private SQL bridge (not part of collector rollout)

Do this only after the separate Phase 3 read-only deployment gate, including
the PostgreSQL-role verifier, TLS identity check, and explicit operational
approval. It does not enable database reads by itself.

1. Install
   `deploy/ops/systemd/edutrack-ops-api-sql-worker.conf.template` as
   `/etc/systemd/system/edutrack-ops-api.service.d/sql-worker.conf`.
2. Create these two root-owned, mode-`0400`, nonempty credential files:

   - `/etc/edutrack-ops/credentials/ops-sql-worker-hmac` contains the same HMAC
     value loaded by `edutrack-ops-sql-worker.service`.
   - `/etc/edutrack-ops/credentials/ops-sql-audit-encryption-key` contains a
     distinct 32-byte key encoded as base64url. It encrypts SQL artifacts and
     must never reuse the MFA encryption key.

3. Set all four values in `/etc/edutrack-ops/api.env`:

   ```ini
   OPS_SQL_WORKER_ENABLED=true
   OPS_SQL_SOCKET_PATH=/run/edutrack-ops/sql-worker.sock
   OPS_SQL_WORKER_HMAC_REFERENCE=ops-sql-worker-hmac
   OPS_SQL_AUDIT_ENCRYPTION_KEY_REFERENCE=ops-sql-audit-encryption-key
   ```

4. Run `systemctl daemon-reload` and restart the API. Keep the worker's
   `OPS_SQL_READ_ENABLED=false` until its independent read-only gate has also
   been approved.

Removing either the drop-in or `OPS_SQL_WORKER_ENABLED=true` disables the API
route after the next restart; do both when rolling the bridge back.

## Acceptance checks

- `systemctl status edutrack-ops-api` is healthy and `curl -fsS
  https://man.thienuy.edu.vn/healthz` returns `{"status":"ok"}`.
- A browser event from `https://thienuy.edu.vn` gets the intended CORS response;
  an unlisted Origin receives no CORS grant.
- Replaying an identical signed server request returns `REPLAYED_NONCE`.
- `systemctl status edutrack-ops-processor` is healthy; a controlled synthetic
  event becomes a grouped issue in the Ops database.
- `systemctl status edutrack-ops-notifier` is healthy; it creates deduplicated
  alert-delivery records only. Do not configure Zalo or email provider
  credentials or dispatch channels until the alert policy review is approved.
- Stop the user app briefly in a controlled window; the Ops collector stays
  healthy. Stop the collector; user requests remain healthy and spool locally.
- Do not send actual Zalo/email alerts or mutate production data during this
  collector-only deployment.
- `systemctl status edutrack-ops-sql-worker` is healthy; its socket is visible
  only at `/run/edutrack-ops/sql-worker.sock`, and its service credential
  directory contains no production database URL while
  `OPS_SQL_READ_ENABLED=false`.
