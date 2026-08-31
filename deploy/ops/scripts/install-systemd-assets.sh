#!/usr/bin/env bash
set -euo pipefail
umask 022

SCRIPT_DIR="$(unset CDPATH; cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
readonly ASSET_ROOT="${EDUTRACK_OPS_CONFIG_AGENT_ASSET_ROOT:-$SCRIPT_DIR/..}"
readonly AGENT_SERVICE_SOURCE="$ASSET_ROOT/systemd/ops-config-agent.service"
readonly TMPFILES_SOURCE="$ASSET_ROOT/systemd/ops-config-agent.tmpfiles.conf"
readonly ENV_EXAMPLE_SOURCE="$ASSET_ROOT/env/config-agent.env.example"
readonly AGENT_RELATIVE_BINARY="apps/config-agent/dist/apps/config-agent/src/index.js"
readonly MANIFEST_RELATIVE_PATH="deploy/ops/config-agent/manifest.yaml"
readonly CATALOG_RELATIVE_PATH="config/variables/catalog.yaml"
readonly AGENT_USER=edutrack-config-agent
readonly SOCKET_GROUP=edutrack-config-api
readonly API_USER=edutrack-ops-api
readonly PROTOCOL_CREDENTIAL=config-agent-protocol-hmac
readonly FINGERPRINT_CREDENTIAL=config-agent-fingerprint-hmac

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [[ "${EDUTRACK_OPS_CONFIG_AGENT_TEST_MODE:-}" == '1' ]]; then
  TEST_ROOT="${EDUTRACK_OPS_CONFIG_AGENT_TEST_ROOT:-}"
  [[ -d "$TEST_ROOT" && ! -L "$TEST_ROOT" ]] || fail CONFIG_AGENT_TEST_ROOT_INVALID
  TEST_ROOT="$(unset CDPATH; cd -P -- "$TEST_ROOT" && pwd)" || fail CONFIG_AGENT_TEST_ROOT_INVALID
  [[ "$(dirname -- "$TEST_ROOT")" == /tmp && "${TEST_ROOT##*/}" == edutrack-config-agent-test-* ]] ||
    fail CONFIG_AGENT_TEST_ROOT_INVALID
  readonly ROOT="$TEST_ROOT"
  readonly SYSTEMCTL="${EDUTRACK_OPS_TEST_SYSTEMCTL:-/usr/bin/true}"
  readonly SYSTEMD_ANALYZE="${EDUTRACK_OPS_TEST_SYSTEMD_ANALYZE:-/usr/bin/true}"
else
  [[ "$(id -u)" == 0 ]] || fail CONFIG_AGENT_ROOT_REQUIRED
  [[ -z "${EDUTRACK_OPS_CONFIG_AGENT_TEST_ROOT:-}${EDUTRACK_OPS_TEST_SYSTEMCTL:-}${EDUTRACK_OPS_TEST_SYSTEMD_ANALYZE:-}" ]] ||
    fail CONFIG_AGENT_TEST_OVERRIDE_FORBIDDEN
  readonly ROOT=/
  readonly SYSTEMCTL=/usr/bin/systemctl
  readonly SYSTEMD_ANALYZE=/usr/bin/systemd-analyze
  [[ -x "$SYSTEMCTL" ]] || fail CONFIG_AGENT_SYSTEMCTL_ABSENT
  [[ -x "$SYSTEMD_ANALYZE" ]] || fail CONFIG_AGENT_SYSTEMD_ANALYZE_ABSENT
fi

readonly RELEASE_INPUT="${1:-}"
[[ -n "$RELEASE_INPUT" && -d "$RELEASE_INPUT" && ! -L "$RELEASE_INPUT" ]] || fail CONFIG_AGENT_RELEASE_INVALID
readonly RELEASE="$(unset CDPATH; cd -P -- "$RELEASE_INPUT" && pwd)" || fail CONFIG_AGENT_RELEASE_INVALID
readonly VERSION="${RELEASE##*/}"
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail CONFIG_AGENT_RELEASE_VERSION_INVALID

readonly CONFIG_DIRECTORY="$ROOT/etc/edutrack-ops"
readonly CREDENTIAL_DIRECTORY="$CONFIG_DIRECTORY/credentials"
readonly SYSTEMD_DIRECTORY="$ROOT/etc/systemd/system"
readonly TMPFILES_DIRECTORY="$ROOT/etc/tmpfiles.d"
readonly AGENT_DIRECTORY="$ROOT/srv/edutrack-ops/config-agent"
readonly AGENT_RELEASES="$AGENT_DIRECTORY/releases"
readonly AGENT_VERSION="$AGENT_RELEASES/$VERSION"
readonly AGENT_CURRENT="$AGENT_DIRECTORY/current"
readonly SERVICE_DEST="$SYSTEMD_DIRECTORY/ops-config-agent.service"
readonly TMPFILES_DEST="$TMPFILES_DIRECTORY/ops-config-agent.conf"
readonly ENV_EXAMPLE_DEST="$CONFIG_DIRECTORY/config-agent.env.example"
readonly PROTOCOL_DEST="$CREDENTIAL_DIRECTORY/$PROTOCOL_CREDENTIAL"
readonly FINGERPRINT_DEST="$CREDENTIAL_DIRECTORY/$FINGERPRINT_CREDENTIAL"

[[ -f "$AGENT_SERVICE_SOURCE" && ! -L "$AGENT_SERVICE_SOURCE" ]] || fail CONFIG_AGENT_SERVICE_ASSET_ABSENT
[[ -f "$TMPFILES_SOURCE" && ! -L "$TMPFILES_SOURCE" ]] || fail CONFIG_AGENT_TMPFILES_ASSET_ABSENT
[[ -f "$ENV_EXAMPLE_SOURCE" && ! -L "$ENV_EXAMPLE_SOURCE" ]] || fail CONFIG_AGENT_ENV_ASSET_ABSENT
[[ -f "$RELEASE/$AGENT_RELATIVE_BINARY" && ! -L "$RELEASE/$AGENT_RELATIVE_BINARY" ]] || fail CONFIG_AGENT_BINARY_ABSENT
[[ -f "$RELEASE/$MANIFEST_RELATIVE_PATH" && ! -L "$RELEASE/$MANIFEST_RELATIVE_PATH" ]] || fail CONFIG_AGENT_MANIFEST_ABSENT
[[ -f "$RELEASE/$CATALOG_RELATIVE_PATH" && ! -L "$RELEASE/$CATALOG_RELATIVE_PATH" ]] || fail CONFIG_AGENT_CATALOG_ABSENT

# Parse and validate the manifest before creating users, directories, links, or units. This
# helper intentionally reports only stable codes and counts; it never prints source bytes.
node --input-type=module - "$RELEASE/$MANIFEST_RELATIVE_PATH" "$RELEASE/$CATALOG_RELATIVE_PATH" <<'NODE'
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { parse as parseYaml } from 'yaml';

const [manifestPath, catalogPath] = process.argv.slice(1);
const fail = (code) => {
  process.stderr.write(`${code}\n`);
  process.exit(1);
};
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  return value;
};
const digest = (value) =>
  `sha256:${createHash('sha256').update(`${JSON.stringify(canonicalize(value))}\n`)
    .digest('hex')}`;
const metadata = (path) => {
  try {
    return execFileSync('/usr/bin/stat', ['-c', '%U:%G:%a:%h:%s:%d:%i', '--', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    fail('CONFIG_AGENT_SOURCE_STAT_FAILED');
  }
};
const assertPath = async (path, source, kind) => {
  if (!isAbsolute(path) || path.includes('\0') || path.split('/').some((part) => part === '..')) {
    fail(`CONFIG_AGENT_${kind}_PATH_INVALID`);
  }
  let current = '/';
  for (const part of path.split('/').filter(Boolean)) {
    current = join(current, part);
    let item;
    try {
      item = await lstat(current);
    } catch {
      fail(`CONFIG_AGENT_${kind}_MISSING`);
    }
    if (item.isSymbolicLink()) fail(`CONFIG_AGENT_${kind}_SYMLINK`);
  }
  let item;
  try {
    item = await lstat(path);
  } catch {
    fail(`CONFIG_AGENT_${kind}_MISSING`);
  }
  if (!item.isFile()) fail(`CONFIG_AGENT_${kind}_NOT_REGULAR`);
  if (item.nlink !== 1) fail(`CONFIG_AGENT_${kind}_HARDLINK`);
  if (item.size > source.maximumBytes) fail(`CONFIG_AGENT_${kind}_OVERSIZE`);
  const before = metadata(path);
  const bytes = await readFile(path);
  if (bytes.includes(0)) fail(`CONFIG_AGENT_${kind}_NUL`);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(`CONFIG_AGENT_${kind}_ENCODING`);
  }
  const after = metadata(path);
  if (before !== after) fail(`CONFIG_AGENT_${kind}_CHANGED`);
  const [owner, group, mode, links, size] = after.split(':');
  if (owner !== source.owner || group !== source.group || mode !== source.mode || links !== '1') {
    fail(`CONFIG_AGENT_${kind}_METADATA_MISMATCH`);
  }
  if (Number(size) > source.maximumBytes) fail(`CONFIG_AGENT_${kind}_OVERSIZE`);
};
const assertActiveRelease = async (locator, source) => {
  if (!locator || locator.kind !== 'active_release_link' || !locator.currentPath || !locator.approvedTargetRoot) {
    fail('CONFIG_AGENT_RELEASE_LOCATOR_INVALID');
  }
  let currentStat;
  try {
    currentStat = await lstat(locator.currentPath);
  } catch {
    fail('CONFIG_AGENT_RELEASE_LINK_MISSING');
  }
  if (!currentStat.isSymbolicLink()) fail('CONFIG_AGENT_RELEASE_LINK_INVALID');
  let current;
  let approved;
  try {
    current = await realpath(locator.currentPath);
    approved = await realpath(locator.approvedTargetRoot);
  } catch {
    fail('CONFIG_AGENT_RELEASE_TARGET_INVALID');
  }
  const targetRelative = relative(approved, current);
  if (!targetRelative || targetRelative.includes('/') || targetRelative === '..' || targetRelative.startsWith('../')) {
    fail('CONFIG_AGENT_RELEASE_TARGET_INVALID');
  }
  if (!locator.fixedDescendant || locator.fixedDescendant.includes('..') || locator.fixedDescendant.startsWith('/')) {
    fail('CONFIG_AGENT_RELEASE_DESCENDANT_INVALID');
  }
  await assertPath(resolve(current, locator.fixedDescendant), source, 'RELEASE_SOURCE');
};

let manifest;
let catalog;
try {
  manifest = parseYaml(await readFile(manifestPath, 'utf8'));
  catalog = parseYaml(await readFile(catalogPath, 'utf8'));
} catch {
  fail('CONFIG_AGENT_CATALOG_MANIFEST_INVALID');
}
if (
  !manifest || manifest.readOnly !== true || !/^\d{4}-\d{2}-\d{2}$/u.test(manifest.manifestVersion ?? '') ||
  !/^\d{4}-\d{2}-\d{2}$/u.test(manifest.catalogVersion ?? '') || manifest.catalogDigest !== digest(catalog)
) fail('CONFIG_AGENT_CATALOG_MANIFEST_MISMATCH');
if (manifest.catalogVersion !== catalog.catalogVersion) fail('CONFIG_AGENT_CATALOG_VERSION_MISMATCH');
if (!Array.isArray(manifest.sources) || !Array.isArray(manifest.apps) || !Array.isArray(manifest.actions) || !Array.isArray(manifest.checks)) {
  fail('CONFIG_AGENT_MANIFEST_STRUCTURE_INVALID');
}
const appIds = new Set(manifest.apps.map((app) => app.id));
const sourceIds = new Set();
for (const source of manifest.sources) {
  if (!source || typeof source.id !== 'string' || sourceIds.has(source.id) || !appIds.has(source.appId)) {
    fail('CONFIG_AGENT_MANIFEST_REFERENCES_INVALID');
  }
  sourceIds.add(source.id);
  if (!/^[0-7]{4}$/u.test(source.mode) || !Number.isInteger(source.maximumBytes) || source.maximumBytes < 1) {
    fail('CONFIG_AGENT_SOURCE_METADATA_INVALID');
  }
  if (source.locator?.kind === 'file') await assertPath(source.locator.path, source, 'SOURCE');
  else if (source.locator?.kind === 'active_release_link') await assertActiveRelease(source.locator, source);
  else fail('CONFIG_AGENT_SOURCE_LOCATOR_INVALID');
}
process.stdout.write(`CONFIG_AGENT_PREFLIGHT_PASS sources=${manifest.sources.length}\n`);
NODE

validate_credential() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || fail CONFIG_AGENT_CREDENTIAL_ABSENT
  local metadata
  metadata="$(stat -c '%U:%G:%a:%h:%s' -- "$path" 2>/dev/null)" || fail CONFIG_AGENT_CREDENTIAL_STAT_FAILED
  [[ "$metadata" == root:root:400:1:* ]] || fail CONFIG_AGENT_CREDENTIAL_METADATA_MISMATCH
  [[ "${metadata##*:}" != 0 ]] || fail CONFIG_AGENT_CREDENTIAL_EMPTY
}

validate_credential "${OPS_CONFIG_AGENT_PROTOCOL_HMAC_SOURCE:-$PROTOCOL_DEST}"
validate_credential "${OPS_CONFIG_AGENT_FINGERPRINT_HMAC_SOURCE:-$FINGERPRINT_DEST}"
# systemd-analyze verify runs before any live asset is replaced.
"$SYSTEMD_ANALYZE" verify "$AGENT_SERVICE_SOURCE" >/dev/null 2>&1 || fail CONFIG_AGENT_SYSTEMD_PREFLIGHT_FAILED

safe_tree() {
  local base="$1" path links
  while IFS= read -r -d '' path; do
    [[ ! -L "$path" ]] || return 1
    links="$(stat -c '%h' -- "$path")" || return 1
    [[ "$links" == 1 ]] || return 1
  done < <(find "$base" -xdev -type f -print0)
}

safe_tree "$RELEASE/apps/config-agent/dist" || fail CONFIG_AGENT_BINARY_TREE_INVALID

if [[ "${EDUTRACK_OPS_CONFIG_AGENT_TEST_MODE:-}" == '1' ]]; then
  : > "$ROOT/.config-agent-users" 2>/dev/null || true
else
  getent group "$SOCKET_GROUP" >/dev/null || groupadd --system "$SOCKET_GROUP"
  getent group "$AGENT_USER" >/dev/null || groupadd --system "$AGENT_USER"
  id "$AGENT_USER" >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin --gid "$AGENT_USER" "$AGENT_USER"
  id "$API_USER" >/dev/null 2>&1 || fail CONFIG_AGENT_API_USER_ABSENT
  usermod --append --groups "$SOCKET_GROUP" "$API_USER"
  usermod --append --groups "$SOCKET_GROUP" "$AGENT_USER"
fi

mkdir -p -- "$AGENT_RELEASES" "$SYSTEMD_DIRECTORY" "$TMPFILES_DIRECTORY" "$CONFIG_DIRECTORY" "$CREDENTIAL_DIRECTORY"
chmod 0755 "$AGENT_DIRECTORY" "$AGENT_RELEASES" "$SYSTEMD_DIRECTORY" "$TMPFILES_DIRECTORY" "$CONFIG_DIRECTORY"
chmod 0750 "$CREDENTIAL_DIRECTORY"

stage="$(mktemp -d "$AGENT_RELEASES/.${VERSION}.XXXXXX")"
cleanup() { rm -rf -- "${stage:-}"; }
trap cleanup EXIT
mkdir -p -- "$stage/apps/config-agent" "$stage/deploy/ops/config-agent" "$stage/config/variables"
cp -a --no-preserve=ownership -- "$RELEASE/apps/config-agent/dist" "$stage/apps/config-agent/"
install -D -m 0755 -- "$RELEASE/$AGENT_RELATIVE_BINARY" "$stage/$AGENT_RELATIVE_BINARY"
install -D -m 0644 -- "$RELEASE/$MANIFEST_RELATIVE_PATH" "$stage/$MANIFEST_RELATIVE_PATH"
install -D -m 0644 -- "$RELEASE/$CATALOG_RELATIVE_PATH" "$stage/$CATALOG_RELATIVE_PATH"
if [[ -e "$AGENT_VERSION" || -L "$AGENT_VERSION" ]]; then
  [[ -d "$AGENT_VERSION" && ! -L "$AGENT_VERSION" ]] || fail CONFIG_AGENT_PRIOR_VERSION_INVALID
  rm -rf -- "$stage"
  stage=''
else
  mv -T -- "$stage" "$AGENT_VERSION"
  stage=''
fi

atomic_install() {
  local source="$1" destination="$2" mode="$3" temporary
  temporary="${destination}.tmp.$$"
  install -D -m "$mode" -- "$source" "$temporary"
  mv -T -- "$temporary" "$destination"
}

# The following operations are deliberately atomic: install -D -m 0755 for the executable,
# install -D -m 0400 (equivalent to chmod 0400) for credentials, then mv -T into the live path.
atomic_install "$AGENT_SERVICE_SOURCE" "$SERVICE_DEST" 0644
atomic_install "$TMPFILES_SOURCE" "$TMPFILES_DEST" 0644
atomic_install "$ENV_EXAMPLE_SOURCE" "$ENV_EXAMPLE_DEST" 0644

install_credential() {
  local source="$1" destination="$2" temporary
  [[ "$source" == "$destination" ]] && return 0
  temporary="${destination}.tmp.$$"
  install -D -o root -g root -m 0400 -- "$source" "$temporary"
  mv -T -- "$temporary" "$destination"
}

install_credential "${OPS_CONFIG_AGENT_PROTOCOL_HMAC_SOURCE:-$PROTOCOL_DEST}" "$PROTOCOL_DEST"
install_credential "${OPS_CONFIG_AGENT_FINGERPRINT_HMAC_SOURCE:-$FINGERPRINT_DEST}" "$FINGERPRINT_DEST"

if [[ -e "$AGENT_CURRENT" || -L "$AGENT_CURRENT" ]]; then
  [[ -L "$AGENT_CURRENT" ]] || fail CONFIG_AGENT_CURRENT_INVALID
fi
current_temporary="$AGENT_DIRECTORY/.current.$$"
ln -s -- "$AGENT_VERSION" "$current_temporary"
mv -T -- "$current_temporary" "$AGENT_CURRENT"

# systemctl daemon-reload is the only manager mutation performed by this inactive installer.
"$SYSTEMCTL" daemon-reload >/dev/null 2>&1 || fail CONFIG_AGENT_DAEMON_RELOAD_FAILED
printf 'CONFIG_AGENT_INSTALLED version=%s\n' "$VERSION"
