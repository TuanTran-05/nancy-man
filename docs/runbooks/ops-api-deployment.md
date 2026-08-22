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
- Keep all SQL feature flags false. The private SQL worker may be installed, but it
  must not receive a production database credential or enable reads yet.
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
3. Install the API, processor, notifier, migration, and SQL-worker systemd units, run `systemctl daemon-reload`, then use the
   explicit one-shot migration command once: `systemctl start` is **not** a
   migration. Run `systemctl start edutrack-ops-migrate.service` and inspect
   its journal before starting `edutrack-ops-api.service`.
4. Install the Nginx template, replace only `REPLACE_WITH_CERT_NAME`, validate
   with `nginx -t`, and reload Nginx. Confirm the Node port has no public
   firewall rule: only Nginx reaches `127.0.0.1:3100`.

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
