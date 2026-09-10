#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly SPOOL_ROOT=/var/lib/edutrack-ops/telemetry

fail() { printf '%s\n' "$1" >&2; exit 1; }

[[ "$(id -u)" == 0 ]] || fail OPS_TELEMETRY_ROOT_REQUIRED

install -d -o root -g root -m 0755 -- /var/lib/edutrack-ops "$SPOOL_ROOT"

while IFS=: read -r user group directory; do
  id "$user" >/dev/null 2>&1 || fail OPS_TELEMETRY_IDENTITY_ABSENT
  getent group "$group" >/dev/null || fail OPS_TELEMETRY_GROUP_ABSENT
  install -d -o "$user" -g "$group" -m 0700 -- "$SPOOL_ROOT/$directory"
done <<'SERVICES'
edutrack-ops-api:edutrack-ops-api:api
edutrack-ops-processor:edutrack-ops-processor:processor
edutrack-ops-notifier:edutrack-ops-notifier:notifier
edutrack-ops-web:edutrack-ops-shared:web
edutrack-ops-collector:edutrack-ops-shared:collector
edutrack-ops-sql-worker:edutrack-ops-sql:sql-worker
edutrack-config-agent:edutrack-config-api:config-agent
edutrack-ops-migrate:edutrack-ops-migrate:migrate
edutrack-config-agent:edutrack-config-api:config-agent-cleanup
edutrack-ops-collector:edutrack-ops-shared:failsafe
edutrack-ops-api:edutrack-ops-api:bootstrap-owner
edutrack-ops-api:edutrack-ops-api:config-agent-smoke
edutrack-ops-api:edutrack-ops-api:telemetry-canary
edutrack-ops-web:edutrack-ops-shared:provision-user
edutrack-ops-collector:edutrack-ops-shared:beszel-smoke
SERVICES
