#!/usr/bin/env bash
set -euo pipefail
umask 022

SCRIPT_DIR="$(unset CDPATH; cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly INSTALLER="$SCRIPT_DIR/install-systemd-assets.sh"
readonly TELEMETRY_ENVIRONMENT_CONFIGURER="$SCRIPT_DIR/configure-telemetry-environment.sh"
readonly TELEMETRY_SPOOL_PROVISIONER="$SCRIPT_DIR/provision-telemetry-spool.sh"
readonly CONFIG_DIRECTORY="${EDUTRACK_OPS_CONFIG_DIRECTORY:-/etc/edutrack-ops}"
readonly API_SERVICE=edutrack-ops-api.service
readonly AGENT_SERVICE=ops-config-agent.service
readonly API_ENV="$CONFIG_DIRECTORY/api.env"
readonly CONFIG_ENV="$CONFIG_DIRECTORY/config-agent.env"
readonly RELEASE="${1:-}"
readonly TELEMETRY_CANARY="$RELEASE/apps/api/dist/apps/api/src/cli/telemetry-canary.js"

fail() { printf '%s\n' "$1" >&2; exit 1; }

[[ -n "$RELEASE" && -d "$RELEASE" && ! -L "$RELEASE" ]] || fail CONFIG_AGENT_RELEASE_INVALID
[[ -x "$INSTALLER" ]] || fail CONFIG_AGENT_INSTALLER_ABSENT
[[ -x "$TELEMETRY_ENVIRONMENT_CONFIGURER" ]] || fail OPS_TELEMETRY_ENV_CONFIGURER_ABSENT
[[ -x "$TELEMETRY_SPOOL_PROVISIONER" ]] || fail OPS_TELEMETRY_PROVISIONER_ABSENT
[[ -f "$TELEMETRY_CANARY" && ! -L "$TELEMETRY_CANARY" ]] || fail TELEMETRY_CANARY_ABSENT

# The installer is deliberately inactive: it stages the version, manifest, and unit but does
# not enable or start the service. Production feature flags remain false until both signed reads
# succeed as the API identity.
"$INSTALLER" "$RELEASE"
"$TELEMETRY_SPOOL_PROVISIONER"
"$TELEMETRY_ENVIRONMENT_CONFIGURER" "$RELEASE"

systemctl restart "$AGENT_SERVICE"

API_IDENTITY="${EDUTRACK_OPS_API_IDENTITY:-edutrack-ops-api}"
SOCKET="${OPS_CONFIG_AGENT_SOCKET_PATH:-/run/edutrack-config-agent/agent.sock}"
readonly SMOKE_CLIENT="${EDUTRACK_OPS_CONFIG_AGENT_SMOKE_CLIENT:-/usr/local/libexec/edutrack-config-agent-smoke}"
[[ -x "$SMOKE_CLIENT" && ! -L "$SMOKE_CLIENT" ]] || fail CONFIG_AGENT_SMOKE_CLIENT_ABSENT
agent_ready=false
for _attempt in {1..25}; do
  if systemctl is-active --quiet ops-config-agent.service && runuser -u "$API_IDENTITY" -- test -S "$SOCKET"; then
    agent_ready=true
    break
  fi
  sleep 0.2
done
[[ "$agent_ready" == true ]] || fail CONFIG_AGENT_START_FAILED
request_as_api() {
  local operation="$1" unit_suffix
  shift
  case "$operation" in
    agent.capabilities) unit_suffix=capabilities ;;
    inventory.read) unit_suffix=inventory ;;
    *) fail CONFIG_AGENT_SMOKE_OPERATION_INVALID ;;
  esac
  /usr/bin/systemd-run \
    --quiet \
    --wait \
    --pipe \
    --collect \
    --service-type=exec \
    --unit="edutrack-ops-config-agent-smoke-$unit_suffix" \
    --uid="$API_IDENTITY" \
    --gid="$API_IDENTITY" \
    --working-directory=/srv/edutrack-ops/current \
    --property="EnvironmentFile=$API_ENV" \
    --property="LoadCredential=config-agent-protocol-hmac:$CONFIG_DIRECTORY/credentials/config-agent-protocol-hmac" \
    --property="LoadCredential=ops-telemetry-hmac:$CONFIG_DIRECTORY/credentials/ops-telemetry-hmac" \
    --property="ReadWritePaths=/var/lib/edutrack-ops/telemetry/config-agent-smoke" \
    --property="RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6" \
    --property=NoNewPrivileges=yes \
    --property=PrivateTmp=yes \
    --property=ProtectHome=yes \
    --property=ProtectSystem=strict \
    "$SMOKE_CLIENT" "$operation" "$@"
}

request_as_api agent.capabilities --socket "$SOCKET" >/dev/null || fail CONFIG_AGENT_CAPABILITIES_FAILED
request_as_api inventory.read --socket "$SOCKET" --ids-only >/dev/null || fail CONFIG_AGENT_INVENTORY_FAILED
systemctl enable "$AGENT_SERVICE" >/dev/null 2>&1 || fail CONFIG_AGENT_ENABLE_FAILED

run_telemetry_canary() {
  local unit_suffix="$1"
  shift
  [[ "$unit_suffix" =~ ^[a-z0-9-]+$ ]] || fail TELEMETRY_CANARY_UNIT_INVALID
  /usr/bin/systemd-run \
    --quiet \
    --wait \
    --pipe \
    --collect \
    --service-type=exec \
    --unit="edutrack-ops-telemetry-canary-$unit_suffix" \
    --uid="$API_IDENTITY" \
    --gid="$API_IDENTITY" \
    --working-directory="$RELEASE" \
    --property="EnvironmentFile=$API_ENV" \
    --property='Environment=OPS_SECRET_DIRECTORY=%d' \
    --property="LoadCredential=ops-database-url:$CONFIG_DIRECTORY/credentials/ops-database-url" \
    --property="LoadCredential=ops-telemetry-hmac:$CONFIG_DIRECTORY/credentials/ops-telemetry-hmac" \
    --property="ReadWritePaths=/var/lib/edutrack-ops/telemetry/telemetry-canary" \
    --property="RestrictAddressFamilies=AF_INET AF_INET6" \
    --property=NoNewPrivileges=yes \
    --property=PrivateTmp=yes \
    --property=ProtectHome=yes \
    --property=ProtectSystem=strict \
    /usr/bin/node "$TELEMETRY_CANARY" "$@" || fail TELEMETRY_CANARY_FAILED
  printf 'OPS_TELEMETRY_CANARY_PASSED mode=%s\n' "$unit_suffix"
}

[[ -f "$API_ENV" && -f "$CONFIG_ENV" ]] || fail CONFIG_AGENT_ENV_ABSENT
temporary_api_env="${API_ENV}.tmp.$$"
cp -p -- "$API_ENV" "$temporary_api_env"
trap 'rm -f -- "${temporary_api_env:-}"' EXIT
if grep -q '^OPS_VARIABLES_READ_ONLY_ENABLED=' "$temporary_api_env"; then
  sed -i 's/^OPS_VARIABLES_READ_ONLY_ENABLED=.*/OPS_VARIABLES_READ_ONLY_ENABLED=true/' "$temporary_api_env"
else
  printf '%s\n' 'OPS_VARIABLES_READ_ONLY_ENABLED=true' >> "$temporary_api_env"
fi
mv -T -- "$temporary_api_env" "$API_ENV"
temporary_api_env=''
systemctl daemon-reload
systemctl restart edutrack-ops-api.service

api_ready=false
for _health_attempt in {1..30}; do
  if curl --fail --silent --max-time 1 \
    -H 'Accept: application/json' \
    "${EDUTRACK_OPS_PUBLIC_HEALTH_URL:-https://man.thienuy.edu.vn/healthz}" >/dev/null; then
    api_ready=true
    break
  fi
  sleep 0.5
done
[[ "$api_ready" == true ]] || fail CONFIG_AGENT_HTTP_SMOKE_FAILED
run_telemetry_canary server --server edutrack-ops-api

browser_canaries="${EDUTRACK_OPS_BROWSER_CANARIES:-edutrack-platform-browser|https://vps.thienuy.edu.vn|edutrack-platform-browser,edutrack-platform-browser|https://esp.thienuy.edu.vn|edutrack-esp-browser,ops-web-public-key|https://man.thienuy.edu.vn|edutrack-ops-web-browser,thienuy-public|https://thienuy.edu.vn|thienuy-public-browser}"
canary_index=0
while IFS='|' read -r project_key origin service extra; do
  [[ -n "$project_key" && -n "$origin" && -n "$service" && -z "$extra" ]] ||
    fail TELEMETRY_CANARY_BROWSER_CONFIGURATION_INVALID
  run_telemetry_canary "browser-$canary_index" --browser "$project_key" "$origin" "$service"
  canary_index=$((canary_index + 1))
done < <(tr ',' '\n' <<< "$browser_canaries")
[[ "$canary_index" -gt 0 ]] || fail TELEMETRY_CANARY_BROWSER_CONFIGURATION_EMPTY
printf 'CONFIG_AGENT_RELEASE_ACTIVE release=%s\n' "${RELEASE##*/}"
