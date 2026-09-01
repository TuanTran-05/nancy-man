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

if [[ "${EDUTRACK_OPS_RELEASE_TEST_MODE:-}" == '1' ]]; then
  RELEASE_ROOT="$(test_root)" || exit 1
  readonly RELEASE_ROOT
  REPOSITORY="${EDUTRACK_OPS_RELEASE_REPOSITORY:-$SCRIPT_DIR/../..}"
  REPOSITORY="$(unset CDPATH; cd -P -- "$REPOSITORY" && pwd)" || fail RELEASE_REPOSITORY_INVALID
  readonly REPOSITORY
else
  [[ -z "${EDUTRACK_OPS_RELEASE_TEST_ROOT:-}${EDUTRACK_OPS_RELEASE_REPOSITORY:-}" ]] || fail RELEASE_TEST_OVERRIDE_FORBIDDEN
  readonly RELEASE_ROOT=/srv/edutrack-ops
  REPOSITORY="$(unset CDPATH; cd -P -- "$SCRIPT_DIR/../.." && pwd)" || fail RELEASE_REPOSITORY_INVALID
  readonly REPOSITORY
  [[ "$(id -u)" == 0 ]] || fail RELEASE_ROOT_REQUIRED
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
    case "$relative" in *..*|*\\*) return 1 ;; esac
    [[ ! -L "$path" ]] || return 1
    links="$(stat -c '%h' -- "$path")"
    [[ "$links" == 1 ]] || return 1
    case "/$relative" in
      */shared/*|*/node_modules/*|*/logs/*|*/backups/*|*/.env|*/.env.*|*/credential/*|*/credentials/*|*/secret/*|*/secrets/*|*/credential|*/credentials|*/secret|*/secrets|*.credential|*.credentials|*.secret|*.secrets|*.pem|*.key|*.p12|*.sqlite|*.sqlite-*|*.db|*.db-*|*.dump|*.sql.gz|*.sql.zip|*.sql.zst) return 1 ;;
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
copy_git_blob() {
  local source entry mode
  source="$1"
  entry="$(git -C "$REPOSITORY" ls-tree "$SHA" -- "$source")"
  mode="${entry%% *}"
  [[ "$mode" == 100644 || "$mode" == 100755 ]] || fail RELEASE_DEPLOY_ASSET_ABSENT
  mkdir -p -- "$STAGING/$(dirname -- "$source")"
  git -C "$REPOSITORY" show "$SHA:$source" > "$STAGING/$source"
}

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
readonly DEPLOY_ASSETS=(
  deploy/ops/release-manifest.mjs
  deploy/ops/env/api.env.example
  deploy/ops/env/collector.env.example
  deploy/ops/env/sql-worker.env.example
  deploy/ops/env/web.env.example
  deploy/ops/nginx/man.thienuy.edu.vn-api.conf
  deploy/ops/systemd/edutrack-ops-api.service
  deploy/ops/systemd/edutrack-ops-web.service
  deploy/ops/systemd/edutrack-ops-collector.service
  deploy/ops/systemd/edutrack-ops-collector-failed@.service
  deploy/ops/systemd/edutrack-ops-processor.service
  deploy/ops/systemd/edutrack-ops-notifier.service
  deploy/ops/systemd/edutrack-ops-sql-worker.service
  deploy/ops/systemd/edutrack-ops-migrate.service
)
for asset in "${DEPLOY_ASSETS[@]}"; do copy_git_blob "$asset"; done

node -e '
const fs=require("node:fs"); const value=fs.readFileSync(process.argv[1],"utf8");
if (!/location (?:\^~ )?\/api\/v1\//.test(value) || !/location = \/api\/zalo-bot\/webhook/.test(value) || !/location = \/api\/session \{[\s\S]*?return 410;/.test(value) || /location \/api\/ \{/.test(value)) process.exit(1);
' "$STAGING/deploy/ops/nginx/man.thienuy.edu.vn-api.conf" || fail RELEASE_PUBLIC_ROUTING_INVALID

node "$MANIFEST_TOOL" generate "$STAGING" >/dev/null
# shellcheck disable=SC2016 # JavaScript template interpolation must reach Node literally.
manifest_digest="$(node -e 'const fs=require("node:fs"), crypto=require("node:crypto"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(crypto.createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex"));' "$STAGING/.release-manifest.json")"
printf '{"gitSha":"%s","treeSha":"%s","manifestDigest":"%s"}\n' "$SHA" "$tree_sha" "$manifest_digest" > "$STAGING/.release-source.json"
node "$MANIFEST_TOOL" verify "$STAGING" >/dev/null || fail RELEASE_MANIFEST_INVALID

mv -T -- "$STAGING" "$TARGET"
trap - EXIT
printf 'RELEASE_PREPARED release=%s sha=%s\n' "${TARGET##*/}" "$SHA"
