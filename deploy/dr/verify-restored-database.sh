#!/usr/bin/env bash
set -euo pipefail

readonly PSQL_BIN="${PSQL_BIN:-psql}"

fail() {
  printf '%s\n' "restored database verification failed: $1" >&2
  exit 2
}

if [ "$#" -ne 4 ] || [ "$1" != '--target-host-id' ] || [ "$3" != '--target-database-url' ]; then
  fail 'usage: verify-restored-database.sh --target-host-id <restore-host> --target-database-url <isolated-url>'
fi

target_host_id="$2"
target_database_url="$4"
production_host_id="${OPS_DR_PRODUCTION_HOST_ID:-}"
isolated_restore_host_id="${OPS_DR_ISOLATED_RESTORE_HOST_ID:-}"
edutrack_release_dir="${EDUTRACK_RELEASE_DIR:-}"

[ -n "$production_host_id" ] || fail 'OPS_DR_PRODUCTION_HOST_ID is required'
[ -n "$isolated_restore_host_id" ] || fail 'OPS_DR_ISOLATED_RESTORE_HOST_ID is required'
[ -n "$edutrack_release_dir" ] || fail 'EDUTRACK_RELEASE_DIR is required'
[ "$target_host_id" != "$production_host_id" ] || fail 'verification target must not be production'
[ "$target_host_id" = "$isolated_restore_host_id" ] || fail 'verification target host is not allowlisted'
[ -f "$edutrack_release_dir/db/verify-schema.sql" ] || fail 'verify-schema.sql is missing from the release'
[ -f "$edutrack_release_dir/db/verify-data.sql" ] || fail 'verify-data.sql is missing from the release'

target_database="$(
  node --input-type=module -e '
    const parsed = new URL(process.argv[1]);
    const database = decodeURIComponent(parsed.pathname.slice(1));
    if (!database.startsWith("edutrack_recovery_")) process.exit(2);
    process.stdout.write(database);
  ' "$target_database_url"
)" || fail 'verification URL must use an edutrack_recovery_ database'

command -v "$PSQL_BIN" >/dev/null 2>&1 || fail 'psql is unavailable'
verification_output="$(mktemp "${TMPDIR:-/tmp}/edutrack-recovery-verification.XXXXXX.log")"
trap 'rm -f "$verification_output"' EXIT

"$PSQL_BIN" "$target_database_url" -X -v ON_ERROR_STOP=1 -f "$edutrack_release_dir/db/verify-schema.sql" | tee "$verification_output"
"$PSQL_BIN" "$target_database_url" -X -v ON_ERROR_STOP=1 -f "$edutrack_release_dir/db/verify-data.sql" | tee -a "$verification_output"
if grep -Eq '(^|[^A-Z])FAIL([^A-Z]|$)' "$verification_output"; then
  fail 'restore verification reported FAIL'
fi

printf '%s\n' "isolated recovery verification passed for ${target_host_id}/${target_database}"
