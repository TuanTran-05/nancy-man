#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly CONFIG_DIRECTORY="${EDUTRACK_OPS_CONFIG_DIRECTORY:-/etc/edutrack-ops}"
readonly RELEASE="${1:-}"
readonly INGEST_URL=https://man.thienuy.edu.vn/api/v1/ingest/server
readonly KEY_ID=edutrack-ops-runtime
readonly SECRET_REFERENCE=ops-telemetry-hmac
readonly SPOOL_ROOT=/var/lib/edutrack-ops/telemetry

fail() { printf '%s\n' "$1" >&2; exit 1; }

if [[ "${EDUTRACK_OPS_TELEMETRY_TEST_MODE:-}" == 1 ]]; then
  test_root="${EDUTRACK_OPS_TELEMETRY_TEST_ROOT:-}"
  [[ -d "$test_root" && ! -L "$test_root" ]] || fail OPS_TELEMETRY_TEST_ROOT_INVALID
  test_root="$(unset CDPATH; cd -P -- "$test_root" && pwd)" || fail OPS_TELEMETRY_TEST_ROOT_INVALID
  [[ "$(dirname -- "$test_root")" == /tmp && "${test_root##*/}" == edutrack-telemetry-env-test-* ]] ||
    fail OPS_TELEMETRY_TEST_ROOT_INVALID
  [[ "$CONFIG_DIRECTORY" == "$test_root/etc/edutrack-ops" ]] ||
    fail OPS_TELEMETRY_TEST_CONFIG_DIRECTORY_INVALID
  [[ "$RELEASE" == "$test_root/releases/"* ]] || fail OPS_TELEMETRY_TEST_RELEASE_INVALID
else
  [[ -z "${EDUTRACK_OPS_TELEMETRY_TEST_ROOT:-}" ]] || fail OPS_TELEMETRY_TEST_OVERRIDE_FORBIDDEN
  [[ "$(id -u)" == 0 ]] || fail OPS_TELEMETRY_ROOT_REQUIRED
fi
[[ -d "$CONFIG_DIRECTORY" && ! -L "$CONFIG_DIRECTORY" ]] || fail OPS_TELEMETRY_CONFIG_DIRECTORY_INVALID
[[ -n "$RELEASE" && -d "$RELEASE" && ! -L "$RELEASE" ]] || fail OPS_TELEMETRY_RELEASE_INVALID
[[ -f "$RELEASE/.release-source.json" && ! -L "$RELEASE/.release-source.json" ]] ||
  fail OPS_TELEMETRY_RELEASE_MARKER_ABSENT

readonly RELEASE_SHA="$(node -e '
const fs = require("node:fs");
try {
  const marker = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (
    Object.keys(marker).some((key) => !["gitSha", "treeSha", "manifestDigest"].includes(key)) ||
    !/^[0-9a-f]{40}$/.test(marker.gitSha) ||
    !/^[0-9a-f]{40}$/.test(marker.treeSha) ||
    !/^[0-9a-f]{64}$/.test(marker.manifestDigest)
  ) process.exit(1);
  process.stdout.write(marker.gitSha);
} catch { process.exit(1); }
' "$RELEASE/.release-source.json")" || fail OPS_TELEMETRY_RELEASE_MARKER_INVALID
[[ "${RELEASE##*/}" == "$RELEASE_SHA" ]] || fail OPS_TELEMETRY_RELEASE_ID_MISMATCH

temporary=''
cleanup() { [[ -z "$temporary" ]] || rm -f -- "$temporary"; }
trap cleanup EXIT

set_value() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$temporary"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$temporary"
  else
    printf '%s=%s\n' "$key" "$value" >> "$temporary"
  fi
}

configure_environment() {
  local name="$1" hmac_file="${2:-}" path
  path="$CONFIG_DIRECTORY/$name"
  [[ -f "$path" && ! -L "$path" ]] || fail OPS_TELEMETRY_ENV_ABSENT
  temporary="${path}.tmp.$$"
  cp -p -- "$path" "$temporary"

  set_value OPS_TELEMETRY_ENABLED true
  set_value OPS_TELEMETRY_INGEST_URL "$INGEST_URL"
  set_value OPS_TELEMETRY_KEY_ID "$KEY_ID"
  set_value OPS_TELEMETRY_HMAC_SECRET_REFERENCE "$SECRET_REFERENCE"
  if [[ -n "$hmac_file" ]]; then set_value OPS_TELEMETRY_HMAC_FILE "$hmac_file"; fi
  set_value OPS_TELEMETRY_RELEASE "$RELEASE_SHA"
  set_value OPS_TELEMETRY_SPOOL_ROOT "$SPOOL_ROOT"
  set_value OPS_TELEMETRY_SPOOL_DIRECTORY "$SPOOL_ROOT"
  if [[ "$name" == collector.env ]]; then
    set_value OPS_PM2_ERROR_LOG_PATH /srv/edutrack/shared/logs/app-error.log
  fi
  if [[ "$name" == web.env ]]; then
    set_value VITE_OPS_BROWSER_TELEMETRY_ENABLED true
    set_value VITE_OPS_BROWSER_INGEST_URL https://man.thienuy.edu.vn/api/v1/ingest/browser
    set_value VITE_OPS_BROWSER_PROJECT_KEY ops-web-public-key
    set_value VITE_APP_RELEASE_SHA "$RELEASE_SHA"
  fi

  mv -T -- "$temporary" "$path"
  temporary=''
}

configure_environment api.env
configure_environment web.env /run/credentials/edutrack-ops-web.service/ops-telemetry-hmac
configure_environment collector.env /run/credentials/edutrack-ops-collector.service/ops-telemetry-hmac
configure_environment config-agent.env /run/credentials/ops-config-agent.service/ops-telemetry-hmac
configure_environment sql-worker.env /run/credentials/edutrack-ops-sql-worker.service/ops-telemetry-hmac

printf 'OPS_TELEMETRY_ENV_CONFIGURED release=%s\n' "$RELEASE_SHA"
