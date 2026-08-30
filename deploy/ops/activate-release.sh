#!/usr/bin/env bash
set -euo pipefail
umask 022

SCRIPT_DIR="$(unset CDPATH; cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly MANIFEST_TOOL="$SCRIPT_DIR/release-manifest.mjs"
TEST_TMP_DIRECTORY=/tmp
readonly TEST_TMP_DIRECTORY
fail() { printf '%s\n' "$1" >&2; exit 1; }

test_root() {
  local candidate resolved parent
  [[ "${EDUTRACK_OPS_RELEASE_TEST_MODE:-}" == '1' ]] || fail RELEASE_TEST_MODE_REQUIRED
  candidate="${EDUTRACK_OPS_RELEASE_TEST_ROOT:-}"
  [[ -d "$candidate" && ! -L "$candidate" ]] || fail RELEASE_TEST_ROOT_INVALID
  resolved="$(unset CDPATH; cd -P -- "$candidate" && pwd)" || fail RELEASE_TEST_ROOT_INVALID
  parent="$(dirname -- "$resolved")"
  [[ "$parent" == "$TEST_TMP_DIRECTORY" && "${resolved##*/}" == edutrack-ops-release-test-* ]] || fail RELEASE_TEST_ROOT_INVALID
  [[ -d "$candidate/releases" && ! -L "$candidate" && ! -L "$candidate/releases" ]] || fail RELEASE_TEST_ROOT_INVALID
  printf '%s\n' "$resolved"
}

test_command() {
  local candidate resolved
  candidate="$1"
  [[ -n "$candidate" && -f "$candidate" && -x "$candidate" && ! -L "$candidate" ]] || return 1
  resolved="$(readlink -f -- "$candidate" 2>/dev/null)" || return 1
  [[ "$resolved" == "$RELEASE_ROOT"/* && -f "$resolved" && -x "$resolved" ]] || return 1
  printf '%s\n' "$resolved"
}

if [[ "${EDUTRACK_OPS_RELEASE_TEST_MODE:-}" == '1' ]]; then
  RELEASE_ROOT="$(test_root)" || exit 1
  readonly RELEASE_ROOT
  readonly UNIT_DIRECTORY="$RELEASE_ROOT/installed/systemd"
  readonly NGINX_DIRECTORY="$RELEASE_ROOT/installed/nginx"
  SYSTEMCTL="$(test_command "${EDUTRACK_OPS_TEST_SYSTEMCTL:-}")" || fail RELEASE_TEST_SYSTEMCTL_INVALID
  readonly SYSTEMCTL
  NGINX="$(test_command "${EDUTRACK_OPS_TEST_NGINX:-}")" || fail RELEASE_TEST_NGINX_INVALID
  readonly NGINX
  readonly SYSTEMD_ANALYZE="$SYSTEMCTL"
else
  [[ -z "${EDUTRACK_OPS_RELEASE_TEST_ROOT:-}${EDUTRACK_OPS_TEST_SYSTEMCTL:-}${EDUTRACK_OPS_TEST_NGINX:-}" ]] || fail RELEASE_TEST_OVERRIDE_FORBIDDEN
  readonly RELEASE_ROOT=/srv/edutrack-ops
  readonly UNIT_DIRECTORY=/etc/systemd/system
  readonly NGINX_DIRECTORY=/etc/nginx/conf.d
  [[ "$(id -u)" == 0 ]] || fail RELEASE_ROOT_REQUIRED
  [[ -x /usr/bin/systemctl && -f /usr/bin/systemctl ]] || fail RELEASE_SYSTEMCTL_ABSENT
  [[ -x /usr/sbin/nginx && -f /usr/sbin/nginx ]] || fail RELEASE_NGINX_ABSENT
  [[ -x /usr/bin/systemd-analyze && -f /usr/bin/systemd-analyze ]] || fail RELEASE_SYSTEMD_ANALYZE_ABSENT
  readonly SYSTEMCTL=/usr/bin/systemctl
  readonly NGINX=/usr/sbin/nginx
  readonly SYSTEMD_ANALYZE=/usr/bin/systemd-analyze
fi

readonly SHA="${1:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail RELEASE_SHA_INVALID
readonly RELEASE="$RELEASE_ROOT/releases/$SHA"
[[ -d "$RELEASE" && ! -L "$RELEASE" ]] || fail RELEASE_TARGET_ABSENT
[[ -f "$RELEASE/.release-source.json" && -f "$RELEASE/.release-manifest.json" ]] || fail RELEASE_MARKER_ABSENT
node "$MANIFEST_TOOL" verify "$RELEASE" >/dev/null

# shellcheck disable=SC2016 # JavaScript template interpolation must reach Node literally.
node -e '
const fs=require("node:fs"), crypto=require("node:crypto"); try { const marker=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const manifest=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); const digest=crypto.createHash("sha256").update(`${JSON.stringify(manifest)}\n`).digest("hex"); if (marker.gitSha!==process.argv[3] || !/^[0-9a-f]{40}$/.test(marker.treeSha) || marker.manifestDigest!==digest || Object.keys(marker).some((key)=>!["gitSha","treeSha","manifestDigest"].includes(key))) process.exit(1); } catch { process.exit(1); }
' "$RELEASE/.release-source.json" "$RELEASE/.release-manifest.json" "$SHA" || fail RELEASE_MARKER_INVALID

readonly UNITS=(
  edutrack-ops-api.service
  edutrack-ops-web.service
  edutrack-ops-collector.service
  edutrack-ops-collector-failed@.service
  edutrack-ops-processor.service
  edutrack-ops-notifier.service
  edutrack-ops-sql-worker.service
  edutrack-ops-migrate.service
)
for unit in "${UNITS[@]}"; do [[ -f "$RELEASE/deploy/ops/systemd/$unit" && ! -L "$RELEASE/deploy/ops/systemd/$unit" ]] || fail RELEASE_UNIT_ASSET_ABSENT; done
readonly VHOST=man.thienuy.edu.vn-api.conf
[[ -f "$RELEASE/deploy/ops/nginx/$VHOST" && ! -L "$RELEASE/deploy/ops/nginx/$VHOST" ]] || fail RELEASE_NGINX_ASSET_ABSENT
for required in \
  apps/api/dist/apps/api/src/runtime/main.js \
  apps/notifier/dist/apps/notifier/src/runtime/main.js \
  apps/processor/dist/apps/processor/src/runtime/main.js \
  apps/sql-worker/dist/apps/sql-worker/src/index.js \
  apps/web/dist/server/web-entry.js \
  apps/web/dist/server/collector-entry.js \
  apps/web/dist/server/failsafe-entry.js; do
  [[ -f "$RELEASE/$required" && ! -L "$RELEASE/$required" ]] || fail RELEASE_REQUIRED_FILE_ABSENT
done

"$SYSTEMD_ANALYZE" verify "${UNITS[@]/#/$RELEASE/deploy/ops/systemd/}" >/dev/null 2>&1 || fail RELEASE_SYSTEMD_PREFLIGHT_FAILED

if [[ "${EDUTRACK_OPS_RELEASE_TEST_MODE:-}" == '1' ]]; then
  TEMP_DIRECTORY="$RELEASE_ROOT/.activation-tmp"
  mkdir -p -- "$TEMP_DIRECTORY"
else
  TEMP_DIRECTORY=/tmp
fi
nginx_preflight="$(mktemp "$TEMP_DIRECTORY/edutrack-ops-nginx-preflight.XXXXXX")"
trap 'rm -f -- "$nginx_preflight"' EXIT
printf 'events {}\nhttp { include %s; }\n' "$RELEASE/deploy/ops/nginx/$VHOST" > "$nginx_preflight"
"$NGINX" -t -c "$nginx_preflight" >/dev/null 2>&1 || fail RELEASE_NGINX_PREFLIGHT_FAILED
rm -f -- "$nginx_preflight"
trap - EXIT

previous=''
if [[ -L "$RELEASE_ROOT/current" ]]; then
  candidate="$(readlink -f -- "$RELEASE_ROOT/current" 2>/dev/null || true)"
  [[ "$candidate" == "$RELEASE_ROOT/releases/"* && -d "$candidate" && ! -L "$candidate" ]] || fail RELEASE_PREVIOUS_POINTER_INVALID
  previous="$candidate"
elif [[ -e "$RELEASE_ROOT/current" ]]; then
  fail RELEASE_PREVIOUS_POINTER_INVALID
fi

readonly SERVICES=(
  edutrack-ops-migrate.service
  edutrack-ops-api.service
  edutrack-ops-sql-worker.service
  edutrack-ops-processor.service
  edutrack-ops-notifier.service
  edutrack-ops-web.service
  edutrack-ops-collector.service
)
transaction_directory="$(mktemp -d "$TEMP_DIRECTORY/edutrack-ops-activate.XXXXXX")"
declare -a CONFIG_DESTINATIONS CONFIG_SOURCES CONFIG_STATE SERVICE_ACTIVE CANDIDATE_STARTED
for unit in "${UNITS[@]}"; do
  CONFIG_DESTINATIONS+=("$UNIT_DIRECTORY/$unit")
  CONFIG_SOURCES+=("$RELEASE/deploy/ops/systemd/$unit")
done
CONFIG_DESTINATIONS+=("$NGINX_DIRECTORY/$VHOST")
CONFIG_SOURCES+=("$RELEASE/deploy/ops/nginx/$VHOST")
for index in "${!CONFIG_DESTINATIONS[@]}"; do
  if [[ -e "${CONFIG_DESTINATIONS[$index]}" || -L "${CONFIG_DESTINATIONS[$index]}" ]]; then
    [[ -f "${CONFIG_DESTINATIONS[$index]}" && ! -L "${CONFIG_DESTINATIONS[$index]}" ]] || fail RELEASE_PRIOR_CONFIG_INVALID
    CONFIG_STATE[index]=present
    cp -p -- "${CONFIG_DESTINATIONS[$index]}" "$transaction_directory/config-$index"
  else
    CONFIG_STATE[index]=absent
  fi
done
for service in "${SERVICES[@]}"; do
  if "$SYSTEMCTL" is-active --quiet "$service"; then SERVICE_ACTIVE+=(active); else SERVICE_ACTIVE+=(inactive); fi
done

rollback() {
  local primary="$1" rollback_failed=0 index service state
  for index in "${!SERVICES[@]}"; do
    if [[ "${CANDIDATE_STARTED[$index]:-0}" == 1 ]]; then "$SYSTEMCTL" stop "${SERVICES[$index]}" >/dev/null 2>&1 || true; fi
  done
  if [[ -n "$previous" ]]; then swap_pointer "$previous" || rollback_failed=1; else rm -f -- "$RELEASE_ROOT/current" || rollback_failed=1; fi
  for index in "${!CONFIG_DESTINATIONS[@]}"; do
    if [[ "${CONFIG_STATE[$index]}" == present ]]; then install -D -m 0644 -- "$transaction_directory/config-$index" "${CONFIG_DESTINATIONS[$index]}" || rollback_failed=1; else rm -f -- "${CONFIG_DESTINATIONS[$index]}" || rollback_failed=1; fi
  done
  "$SYSTEMCTL" daemon-reload >/dev/null 2>&1 || rollback_failed=1
  for index in "${!SERVICES[@]}"; do
    service="${SERVICES[$index]}"
    state="${SERVICE_ACTIVE[$index]}"
    if [[ "$state" == active ]]; then "$SYSTEMCTL" start "$service" >/dev/null 2>&1 || rollback_failed=1; fi
  done
  "$NGINX" -s reload >/dev/null 2>&1 || rollback_failed=1
  rm -rf -- "$transaction_directory"
  if [[ "$rollback_failed" == 1 ]]; then printf 'RELEASE_ROLLBACK_FAILED primary=%s\n' "$primary" >&2; fi
  printf '%s\n' "$primary" >&2
  exit 1
}

swap_pointer() {
  local target="$1" temporary="$RELEASE_ROOT/.current.${SHA}.$$"
  ln -s -- "$target" "$temporary" || return 1
  if ! mv -T -- "$temporary" "$RELEASE_ROOT/current"; then rm -f -- "$temporary"; return 1; fi
}

for service in edutrack-ops-web.service edutrack-ops-collector.service; do "$SYSTEMCTL" stop "$service" || rollback RELEASE_WRITER_COHORT_STOP_FAILED; done
for service in edutrack-ops-web.service edutrack-ops-collector.service; do "$SYSTEMCTL" is-active --quiet "$service" && rollback RELEASE_WRITER_COHORT_ACTIVE; done

mkdir -p -- "$UNIT_DIRECTORY" "$NGINX_DIRECTORY" || rollback RELEASE_CONFIG_DIRECTORY_FAILED
for index in "${!CONFIG_DESTINATIONS[@]}"; do install -m 0644 -- "${CONFIG_SOURCES[$index]}" "${CONFIG_DESTINATIONS[$index]}" || rollback RELEASE_CONFIG_INSTALL_FAILED; done
"$SYSTEMCTL" daemon-reload || rollback RELEASE_DAEMON_RELOAD_FAILED

swap_pointer "$RELEASE" || rollback RELEASE_POINTER_SWAP_FAILED

for index in 0 1 2 3 4; do
  service="${SERVICES[$index]}"
  "$SYSTEMCTL" restart "$service" || rollback RELEASE_ACTIVATION_SERVICE_FAILED
  CANDIDATE_STARTED[index]=1
done
for index in 5 6; do
  service="${SERVICES[$index]}"
  "$SYSTEMCTL" start "$service" || rollback RELEASE_ACTIVATION_SERVICE_FAILED
  CANDIDATE_STARTED[index]=1
done
"$NGINX" -s reload || rollback RELEASE_NGINX_RELOAD_FAILED
rm -rf -- "$transaction_directory"
printf 'RELEASE_ACTIVATED release=%s sha=%s previous=%s\n' "$SHA" "$SHA" "${previous##*/}"
