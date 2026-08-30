#!/usr/bin/env bash
set -euo pipefail
umask 022

readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly MANIFEST_TOOL="$SCRIPT_DIR/release-manifest.mjs"

fail() { printf '%s\n' "$1" >&2; exit 1; }

test_root() {
  local candidate="${EDUTRACK_OPS_RELEASE_TEST_ROOT:-}"
  [[ "${EDUTRACK_OPS_RELEASE_TEST_MODE:-}" == '1' ]] || fail RELEASE_TEST_MODE_REQUIRED
  [[ "$candidate" == /tmp/edutrack-ops-release-test-* ]] || fail RELEASE_TEST_ROOT_INVALID
  [[ -d "$candidate/releases" && ! -L "$candidate" && ! -L "$candidate/releases" ]] || fail RELEASE_TEST_ROOT_INVALID
  printf '%s\n' "$(CDPATH= cd -- "$candidate" && pwd -P)"
}

if [[ "${EDUTRACK_OPS_RELEASE_TEST_MODE:-}" == '1' ]]; then
  RELEASE_ROOT="$(test_root)" || exit 1
  readonly RELEASE_ROOT
  readonly REPOSITORY="${EDUTRACK_OPS_RELEASE_REPOSITORY:-$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)}"
else
  [[ -z "${EDUTRACK_OPS_RELEASE_TEST_ROOT:-}${EDUTRACK_OPS_RELEASE_REPOSITORY:-}" ]] || fail RELEASE_TEST_OVERRIDE_FORBIDDEN
  readonly RELEASE_ROOT=/srv/edutrack-ops
  readonly REPOSITORY="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)"
fi

readonly SHA="${1:-}"
readonly BUILD_DIR="${2:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fail RELEASE_SHA_INVALID
[[ -d "$BUILD_DIR" && ! -L "$BUILD_DIR" ]] || fail RELEASE_BUILD_INVALID
[[ -f "$BUILD_DIR/.edutrack-ops-build.json" && ! -L "$BUILD_DIR/.edutrack-ops-build.json" ]] || fail RELEASE_BUILD_MARKER_ABSENT
[[ -f "$MANIFEST_TOOL" ]] || fail RELEASE_MANIFEST_TOOL_ABSENT

resolved_sha="$(git -C "$REPOSITORY" rev-parse --verify "${SHA}^{commit}" 2>/dev/null || true)"
[[ "$resolved_sha" == "$SHA" ]] || fail RELEASE_SHA_UNREACHABLE
git -C "$REPOSITORY" merge-base --is-ancestor "$SHA" HEAD >/dev/null 2>&1 || fail RELEASE_SHA_UNREACHABLE
tree_sha="$(git -C "$REPOSITORY" rev-parse "${SHA}^{tree}")"
node -e '
const fs=require("node:fs"); const [file, sha, tree]=process.argv.slice(1);
try { const marker=JSON.parse(fs.readFileSync(file,"utf8")); if (marker.gitSha!==sha || marker.treeSha!==tree || Object.keys(marker).some((key)=>!["gitSha","treeSha"].includes(key))) process.exit(1); } catch { process.exit(1); }
' "$BUILD_DIR/.edutrack-ops-build.json" "$SHA" "$tree_sha" || fail RELEASE_BUILD_SOURCE_MISMATCH

readonly TARGET="$RELEASE_ROOT/releases/$SHA"
[[ ! -e "$TARGET" && ! -L "$TARGET" ]] || fail RELEASE_TARGET_EXISTS

is_safe_source_tree() {
  local base="$1" path relative links
  while IFS= read -r -d '' path; do
    relative="${path#"$base"/}"
    [[ "$relative" != *'..'* && "$relative" != *'\\'* ]] || return 1
    [[ ! -L "$path" ]] || return 1
    links="$(stat -c '%h' -- "$path")"
    [[ "$links" == 1 ]] || return 1
    case "/$relative" in
      */shared/*|*/node_modules/*|*/logs/*|*/backups/*|*/.env|*/.env.*|*credential*|*secret*|*.pem|*.key|*.p12|*.sqlite|*.sqlite-*|*.db|*.db-*|*.dump|*.sql.gz|*.sql.zip|*.sql.zst) return 1 ;;
    esac
  done < <(find "$base" -xdev -type f -print0)
}

is_safe_source_tree "$BUILD_DIR" || fail RELEASE_INPUT_FORBIDDEN

for app in api notifier processor sql-worker web; do
  [[ -d "$BUILD_DIR/apps/$app/dist" && ! -L "$BUILD_DIR/apps/$app/dist" ]] || fail RELEASE_BUILD_ARTIFACT_ABSENT
  [[ -f "$BUILD_DIR/apps/$app/package.json" ]] || fail RELEASE_PACKAGE_METADATA_ABSENT
done
[[ -f "$BUILD_DIR/package.json" && -f "$BUILD_DIR/package-lock.json" ]] || fail RELEASE_PACKAGE_METADATA_ABSENT
[[ -d "$BUILD_DIR/packages/db/migrations" ]] || fail RELEASE_MIGRATIONS_ABSENT
for required in \
  apps/api/dist/apps/api/src/runtime/main.js \
  apps/notifier/dist/apps/notifier/src/runtime/main.js \
  apps/processor/dist/apps/processor/src/runtime/main.js \
  apps/sql-worker/dist/apps/sql-worker/src/index.js \
  apps/web/dist/server/web-entry.js \
  apps/web/dist/server/collector-entry.js \
  apps/web/dist/server/failsafe-entry.js; do
  [[ -f "$BUILD_DIR/$required" ]] || fail RELEASE_BUILD_ARTIFACT_ABSENT
done

readonly STAGING="$RELEASE_ROOT/releases/.${SHA}.prepare.$$"
trap 'rm -rf -- "$STAGING"' EXIT
mkdir -- "$STAGING"
copy_file() { install -D -m 0644 -- "$1" "$STAGING/$2"; }
copy_tree() { mkdir -p -- "$STAGING/$2"; cp -a --no-preserve=ownership -- "$1/." "$STAGING/$2/"; }

copy_file "$BUILD_DIR/package.json" package.json
copy_file "$BUILD_DIR/package-lock.json" package-lock.json
for manifest in "$BUILD_DIR"/apps/*/package.json "$BUILD_DIR"/packages/*/package.json; do
  [[ -f "$manifest" ]] || continue
  copy_file "$manifest" "${manifest#"$BUILD_DIR"/}"
done
for dist in "$BUILD_DIR"/apps/*/dist "$BUILD_DIR"/packages/*/dist; do
  [[ -d "$dist" ]] || continue
  copy_tree "$dist" "${dist#"$BUILD_DIR"/}"
done
copy_tree "$BUILD_DIR/packages/db/migrations" packages/db/migrations
for asset in env nginx systemd; do
  [[ -d "$REPOSITORY/deploy/ops/$asset" && ! -L "$REPOSITORY/deploy/ops/$asset" ]] || fail RELEASE_DEPLOY_ASSET_ABSENT
  is_safe_source_tree "$REPOSITORY/deploy/ops/$asset" || fail RELEASE_DEPLOY_ASSET_FORBIDDEN
  copy_tree "$REPOSITORY/deploy/ops/$asset" "deploy/ops/$asset"
done
copy_file "$MANIFEST_TOOL" deploy/ops/release-manifest.mjs

node "$MANIFEST_TOOL" generate "$STAGING" >/dev/null
manifest_digest="$(node -e 'const fs=require("node:fs"), crypto=require("node:crypto"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(crypto.createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex"));' "$STAGING/.release-manifest.json")"
printf '{"gitSha":"%s","treeSha":"%s","manifestDigest":"%s"}\n' "$SHA" "$tree_sha" "$manifest_digest" > "$STAGING/.release-source.json"
node "$MANIFEST_TOOL" verify "$STAGING" >/dev/null || fail RELEASE_MANIFEST_INVALID

mv -T -- "$STAGING" "$TARGET"
trap - EXIT
printf 'RELEASE_PREPARED release=%s sha=%s\n' "${TARGET##*/}" "$SHA"
