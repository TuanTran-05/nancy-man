# Ops release deployment order

This runbook describes the production order for a release that includes the
read-only Config Agent. It does not authorize a live deployment by itself.

1. Verify the release SHA, build marker, catalog digest, manifest version, and
   exact source ownership/mode metadata. Keep `OPS_CONFIG_AGENT_ENABLED=false`
   in the API environment.
2. Run the inactive installer for the release. It creates the dedicated agent
   identity and socket group, stages the bundle and manifest atomically, and
   installs the unit/tmpfiles assets. A failed preflight must not change the
   current pointer, running services, or active configuration.
3. Run `systemd-analyze verify`, `systemctl daemon-reload`, and
   `systemd-tmpfiles --create` for the installed assets.
4. Start `ops-config-agent.service` and confirm its socket is a Unix socket
   owned by `edutrack-config-api` with mode `0660`. Confirm that the API is the
   only non-agent identity in that group.
5. As `edutrack-ops-api`, execute the signed `agent.capabilities` request and
   a bounded `inventory.read` request. The smoke command must print only
   status/counts/IDs; it must not print values, frames, or source bytes.
6. Atomically set `OPS_CONFIG_AGENT_ENABLED=true`, reload systemd, restart the
   API, and verify the HTTPS health endpoint. If any step fails, restore the
   API flag to `false`, restart the API, and leave the previous agent version
   available for rollback.

The web service, Nginx, and unrelated workers are not restarted by the
read-only agent gate. Feature flags are opt-in; no API or agent service should
be enabled merely because an asset is present on disk.

## Rollback

Disable the API flag first, then stop/disable the agent. Select the previous
verified agent bundle, restore its `current` symlink atomically, reinstall its
matching unit and manifest, reload systemd, and repeat capability negotiation
before starting it. Keep the previous service and configuration files until
the replacement has passed all checks. Never delete a release while it may be
the current rollback target.

For source metadata drift, repair the owner, group, mode, or hard-link state
on the host and rerun the installer. Do not relax the manifest or add a broad
read/write path. For key rotation, use private temporary files and atomic
replacement as documented in `ops-config-agent-readonly.md`; protocol and
fingerprint keys must never be reused.

## Health and no-value checks

```bash
systemctl is-active --quiet ops-config-agent.service
systemctl is-active --quiet edutrack-ops-api.service
test -S /run/edutrack-config-agent/agent.sock
stat -c '%F %U:%G %a %h' /run/edutrack-config-agent/agent.sock
curl --fail --silent --show-error https://man.thienuy.edu.vn/healthz >/dev/null
```

Use the value-free journald inspection from the Config Agent runbook. Inventory
inspection is permitted only through the signed API-identity smoke command and
must be limited to counts/IDs. Do not place response bodies in logs, tickets,
shell history, URLs, caches, or audit payloads.
