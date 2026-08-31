#!/usr/bin/env bash
set -euo pipefail
umask 022

SCRIPT_DIR="$(unset CDPATH; cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly INSTALLER="$SCRIPT_DIR/install-systemd-assets.sh"
readonly CONFIG_DIRECTORY="${EDUTRACK_OPS_CONFIG_DIRECTORY:-/etc/edutrack-ops}"
readonly API_SERVICE=edutrack-ops-api.service
readonly AGENT_SERVICE=ops-config-agent.service
readonly API_ENV="$CONFIG_DIRECTORY/api.env"
readonly CONFIG_ENV="$CONFIG_DIRECTORY/config-agent.env"
readonly RELEASE="${1:-}"

fail() { printf '%s\n' "$1" >&2; exit 1; }

[[ -n "$RELEASE" && -d "$RELEASE" && ! -L "$RELEASE" ]] || fail CONFIG_AGENT_RELEASE_INVALID
[[ -x "$INSTALLER" ]] || fail CONFIG_AGENT_INSTALLER_ABSENT

# The installer is deliberately inactive: it stages the version, manifest, and unit but does
# not enable or start the service. Production feature flags remain false until both signed reads
# succeed as the API identity.
"$INSTALLER" "$RELEASE"

systemctl start ops-config-agent.service
systemctl is-active --quiet ops-config-agent.service || fail CONFIG_AGENT_START_FAILED

API_IDENTITY="${EDUTRACK_OPS_API_IDENTITY:-edutrack-ops-api}"
SOCKET="${OPS_CONFIG_AGENT_SOCKET_PATH:-/run/edutrack-config-agent/agent.sock}"
readonly SMOKE_CLIENT="${EDUTRACK_OPS_CONFIG_AGENT_SMOKE_CLIENT:-/usr/local/libexec/edutrack-config-agent-smoke}"
[[ -x "$SMOKE_CLIENT" && ! -L "$SMOKE_CLIENT" ]] || fail CONFIG_AGENT_SMOKE_CLIENT_ABSENT
request_as_api() {
  runuser -u "$API_IDENTITY" -- "$SMOKE_CLIENT" "$@"
}

request_as_api agent.capabilities --socket "$SOCKET" >/dev/null || fail CONFIG_AGENT_CAPABILITIES_FAILED
request_as_api inventory.read --socket "$SOCKET" --ids-only >/dev/null || fail CONFIG_AGENT_INVENTORY_FAILED

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

curl --fail --silent --show-error --max-time 10 \
  -H 'Accept: application/json' \
  "${EDUTRACK_OPS_PUBLIC_HEALTH_URL:-https://man.thienuy.edu.vn/healthz}" >/dev/null || fail CONFIG_AGENT_HTTP_SMOKE_FAILED
printf 'CONFIG_AGENT_RELEASE_ACTIVE release=%s\n' "${RELEASE##*/}"
