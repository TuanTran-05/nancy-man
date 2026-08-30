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
else
  [[ -z "${EDUTRACK_OPS_RELEASE_TEST_ROOT:-}${EDUTRACK_OPS_TEST_SYSTEMCTL:-}${EDUTRACK_OPS_TEST_NGINX:-}" ]] || fail RELEASE_TEST_OVERRIDE_FORBIDDEN
  readonly RELEASE_ROOT=/srv/edutrack-ops
  readonly UNIT_DIRECTORY=/etc/systemd/system
  readonly NGINX_DIRECTORY=/etc/nginx/conf.d
  [[ "$(id -u)" == 0 ]] || fail RELEASE_ROOT_REQUIRED
  [[ -x /usr/bin/systemctl && -f /usr/bin/systemctl ]] || fail RELEASE_SYSTEMCTL_ABSENT
  [[ -x /usr/sbin/nginx && -f /usr/sbin/nginx ]] || fail RELEASE_NGINX_ABSENT
  readonly SYSTEMCTL=/usr/bin/systemctl
  readonly NGINX=/usr/sbin/nginx
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

nginx_preflight="$(mktemp "${TMPDIR:-/tmp}/edutrack-ops-nginx-preflight.XXXXXX")"
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

mkdir -p -- "$UNIT_DIRECTORY" "$NGINX_DIRECTORY"
for unit in "${UNITS[@]}"; do install -m 0644 -- "$RELEASE/deploy/ops/systemd/$unit" "$UNIT_DIRECTORY/$unit"; done
install -m 0644 -- "$RELEASE/deploy/ops/nginx/$VHOST" "$NGINX_DIRECTORY/$VHOST"
"$SYSTEMCTL" daemon-reload

swap_pointer() {
  local target="$1" temporary="$RELEASE_ROOT/.current.${SHA}.$$"
  ln -s -- "$target" "$temporary"
  mv -T -- "$temporary" "$RELEASE_ROOT/current"
}
swap_pointer "$RELEASE"

readonly SERVICES=(
  edutrack-ops-migrate.service
  edutrack-ops-api.service
  edutrack-ops-sql-worker.service
  edutrack-ops-processor.service
  edutrack-ops-notifier.service
  edutrack-ops-web.service
  edutrack-ops-collector.service
)
for service in "${SERVICES[@]}"; do
  if ! "$SYSTEMCTL" restart "$service"; then
    if [[ -n "$previous" ]]; then swap_pointer "$previous"; else rm -f -- "$RELEASE_ROOT/current"; fi
    printf 'RELEASE_ACTIVATION_SERVICE_FAILED service=%s rollback=%s\n' "$service" "${previous##*/}" >&2
    exit 1
  fi
done
"$NGINX" -s reload
printf 'RELEASE_ACTIVATED release=%s sha=%s previous=%s\n' "$SHA" "$SHA" "${previous##*/}"
