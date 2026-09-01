# Read-only Config Agent operations

This runbook covers installation and read-only recovery. Use the
[`catalog-change-review.md`](../checklists/catalog-change-review.md) checklist
for catalog/manifest changes and the
[`ops-config-agent-key-rotation.md`](ops-config-agent-key-rotation.md) runbook
for key retention and re-encryption. Owner recovery and enrollment links have
separate procedures so a read-only rollback never becomes an account reset.

The Config Agent is a local, read-only inventory service. It has no public
listener and it must never receive a database, audit, telemetry, or object
store write path. `OPS_CONFIG_AGENT_ENABLED=false` is the production default;
an operator must complete the checks below before enabling it.

## Install prerequisites

Run these commands as `root` on the Ops host. Use a verified release directory
under `/srv/edutrack-ops/releases/<release-id>`; do not run the installer from a
developer checkout.

```bash
getent group edutrack-config-api || groupadd --system edutrack-config-api
getent group edutrack-config-agent || groupadd --system edutrack-config-agent
id edutrack-config-agent >/dev/null 2>&1 || useradd --system --home-dir /nonexistent \
  --shell /usr/sbin/nologin --gid edutrack-config-agent edutrack-config-agent
usermod --append --groups edutrack-config-api,edutrack-ops,deploy edutrack-config-agent
usermod --append --groups edutrack-config-api edutrack-ops-api
install -d -m 0750 -o root -g edutrack-ops /etc/edutrack-ops
install -d -m 0750 -o root -g edutrack-config-api /run/edutrack-config-agent
```

Grant the non-root agent read access only to the manifest allowlist. Keep the
configuration directory private, make the credential directory traversable by
the dedicated agent group, and do not change credentials for gated SQL features
that are absent while SQL Console is disabled:

```bash
chown root:edutrack-ops /etc/edutrack-ops
chmod 0750 /etc/edutrack-ops
chown root:edutrack-config-agent /etc/edutrack-ops/credentials
chmod 0750 /etc/edutrack-ops/credentials
chgrp edutrack-config-agent \
  /etc/edutrack-ops/credentials/ops-database-url \
  /etc/edutrack-ops/credentials/ops-session-pepper \
  /etc/edutrack-ops/credentials/ops-rate-limit-pepper \
  /etc/edutrack-ops/credentials/browser-context-edutrack-v1 \
  /etc/edutrack-ops/credentials/ops-auth-session-pepper \
  /etc/edutrack-ops/credentials/ops-mfa-encryption-key \
  /etc/edutrack-ops/credentials/ops-password-fingerprint-pepper \
  /etc/edutrack-ops/credentials/ops-legacy-monitoring-hmac \
  /etc/edutrack-ops/credentials/ops-sql-worker-hmac
chmod 0440 \
  /etc/edutrack-ops/credentials/ops-database-url \
  /etc/edutrack-ops/credentials/ops-session-pepper \
  /etc/edutrack-ops/credentials/ops-rate-limit-pepper \
  /etc/edutrack-ops/credentials/browser-context-edutrack-v1 \
  /etc/edutrack-ops/credentials/ops-auth-session-pepper \
  /etc/edutrack-ops/credentials/ops-mfa-encryption-key \
  /etc/edutrack-ops/credentials/ops-password-fingerprint-pepper \
  /etc/edutrack-ops/credentials/ops-legacy-monitoring-hmac \
  /etc/edutrack-ops/credentials/ops-sql-worker-hmac
chgrp deploy /srv/edutrack/shared/.env
chmod 0640 /srv/edutrack/shared/.env
```

The original source credentials remain inaccessible to every other service
group. The agent's own protocol, fingerprint, staging, and snapshot keys remain
`root:root 0400` and reach the service only through systemd credentials.

Create each key in a private temporary file. The commands redirect key bytes
to disk and do not print them:

```bash
install -d -m 0750 -o root -g root /etc/edutrack-ops/credentials
umask 077
openssl rand -hex 32 > /etc/edutrack-ops/credentials/.protocol-hmac.new
openssl rand -hex 32 > /etc/edutrack-ops/credentials/.fingerprint-hmac.new
openssl rand 32 > /etc/edutrack-ops/credentials/.staging-key.new
openssl rand 32 > /etc/edutrack-ops/credentials/.snapshot-key.new
chown root:root /etc/edutrack-ops/credentials/.protocol-hmac.new \
  /etc/edutrack-ops/credentials/.fingerprint-hmac.new \
  /etc/edutrack-ops/credentials/.staging-key.new \
  /etc/edutrack-ops/credentials/.snapshot-key.new
chmod 0400 /etc/edutrack-ops/credentials/.protocol-hmac.new \
  /etc/edutrack-ops/credentials/.fingerprint-hmac.new \
  /etc/edutrack-ops/credentials/.staging-key.new \
  /etc/edutrack-ops/credentials/.snapshot-key.new
mv -T /etc/edutrack-ops/credentials/.protocol-hmac.new \
  /etc/edutrack-ops/credentials/config-agent-protocol-hmac
mv -T /etc/edutrack-ops/credentials/.fingerprint-hmac.new \
  /etc/edutrack-ops/credentials/config-agent-fingerprint-hmac
mv -T /etc/edutrack-ops/credentials/.staging-key.new \
  /etc/edutrack-ops/credentials/config-agent-staging-key
mv -T /etc/edutrack-ops/credentials/.snapshot-key.new \
  /etc/edutrack-ops/credentials/config-agent-snapshot-key
```

The protocol HMAC, fingerprint HMAC, 32-byte staging key, and 32-byte snapshot
key must all remain different. Rotate by writing new private temporary files,
atomically replacing the destination files, then restarting the agent and
repeating capability negotiation. Never place any key in Git, an environment
file, a command argument, or a log.

Install the environment file once, keeping the feature disabled until the
deployment gate passes:

```bash
install -o root -g edutrack-ops -m 0640 \
  /srv/edutrack-ops/current/deploy/ops/env/config-agent.env.example \
  /etc/edutrack-ops/config-agent.env
```

## Install and validate a release

The installer validates the catalog digest, manifest versions, every declared
source's owner/group/mode/size, regular-file and hard-link state, and the
active-release link before it creates or replaces anything. It stages the
agent bundle and uses same-filesystem `mv -T` operations for activation.

```bash
release=/srv/edutrack-ops/releases/<release-id>
systemd-analyze verify deploy/ops/systemd/ops-config-agent.service
/srv/edutrack-ops/current/deploy/ops/scripts/install-systemd-assets.sh "$release"
systemd-tmpfiles --create /etc/tmpfiles.d/ops-config-agent.conf
systemctl daemon-reload
```

If preflight fails, stop and repair the reported metadata condition. The
installer must leave the previous agent bundle, unit, credentials, and active
service unchanged. Do not bypass source checks with a wildcard, a symlink, or
an alternate owner/mode.

## Socket and negotiation checks

The only peer group for the agent socket is `edutrack-config-api`. The API is
the only service identity that should be a member of that group:

```bash
test -S /run/edutrack-config-agent/agent.sock
stat -c '%F %U:%G %a %h' /run/edutrack-config-agent/agent.sock
id edutrack-ops-api
getent group edutrack-config-api
systemctl is-active --quiet ops-config-agent.service
```

Use the signed smoke client installed for the release, as the API identity.
It must print only capability status and inventory counts/IDs:

```bash
runuser -u edutrack-ops-api -- /usr/local/libexec/edutrack-config-agent-smoke \
  agent.capabilities --socket /run/edutrack-config-agent/agent.sock
runuser -u edutrack-ops-api -- /usr/local/libexec/edutrack-config-agent-smoke \
  inventory.read --socket /run/edutrack-config-agent/agent.sock --ids-only
```

The capability response must state protocol version `1`, `readOnly=true`, the
expected catalog/manifest versions and digest, and only the
`inventory.read` operation. Do not use a shell client that reads source files
directly or emits response bodies.

## Value-free log inspection

Inspect service health without displaying log messages. This command emits a
single policy marker only if a log field appears to contain a value-like
payload:

```bash
journalctl -u ops-config-agent.service --since '15 minutes ago' --output=json \
  --no-pager | jq -r '
    select((.MESSAGE // "") | test("value|currentValue|credential|agentResponse"; "i"))
    | "REDACTION_POLICY_VIOLATION"'
```

Expected output is empty. `systemctl status` and health checks should be used
for ordinary readiness; do not copy journal output into tickets when it may
contain inventory data.

## Disable and rollback

Disable the API feature before stopping or replacing the agent:

```bash
install -D -o root -g edutrack-ops -m 0640 /etc/edutrack-ops/api.env \
  /etc/edutrack-ops/.api.env.rollback
sed -i 's/^OPS_CONFIG_AGENT_ENABLED=.*/OPS_CONFIG_AGENT_ENABLED=false/' \
  /etc/edutrack-ops/api.env
systemctl daemon-reload
systemctl restart edutrack-ops-api.service
systemctl stop ops-config-agent.service
systemctl disable ops-config-agent.service
```

For rollback, stop the agent, select the previously verified version under
`/srv/edutrack-ops/config-agent/releases`, atomically restore the `current`
link, reinstall the matching verified unit/assets, and repeat the socket and
capability checks before starting it. Keep the API flag false until the old
agent passes. If any rollback step fails, leave the feature disabled and
preserve the previous service/config files for investigation.
