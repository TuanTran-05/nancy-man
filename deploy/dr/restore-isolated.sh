#!/usr/bin/env bash
set -euo pipefail

readonly PGBACKREST_BIN="${PGBACKREST_BIN:-pgbackrest}"
readonly PG_CTL_BIN="${PG_CTL_BIN:-pg_ctl}"
readonly PSQL_BIN="${PSQL_BIN:-psql}"
readonly PGDATA_ROOT="${RECOVERY_PGDATA_ROOT:-/var/lib/postgresql/16/recovery}"
readonly RECOVERY_PORT="${RECOVERY_POSTGRES_PORT:-55432}"

fail() {
  printf '%s\n' "isolated restore failed: $1" >&2
  exit 2
}

usage() {
  fail 'usage: restore-isolated.sh --recovery-id <RCV_id> --target-host-id <restore-host> --target-database <edutrack_recovery_name> (--target-time <ISO-8601> | --target-lsn <LSN>)'
}

recovery_id=''
target_host_id=''
target_database=''
target_time=''
target_lsn=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --recovery-id) recovery_id="${2:-}"; shift 2 ;;
    --target-host-id) target_host_id="${2:-}"; shift 2 ;;
    --target-database) target_database="${2:-}"; shift 2 ;;
    --target-time) target_time="${2:-}"; shift 2 ;;
    --target-lsn) target_lsn="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done

production_host_id="${OPS_DR_PRODUCTION_HOST_ID:-}"
isolated_restore_host_id="${OPS_DR_ISOLATED_RESTORE_HOST_ID:-}"
[ -n "$production_host_id" ] || fail 'OPS_DR_PRODUCTION_HOST_ID is required'
[ -n "$isolated_restore_host_id" ] || fail 'OPS_DR_ISOLATED_RESTORE_HOST_ID is required'

case "$recovery_id" in RCV_[A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-][A-Za-z0-9_-]*) ;; *) fail 'recovery ID must start with RCV_ and be at least 12 characters' ;; esac
case "$target_database" in edutrack_recovery_[a-z0-9_][a-z0-9_]* ) ;; *) fail 'target database must start with edutrack_recovery_' ;; esac
case "$RECOVERY_PORT" in *[!0-9]* | '') fail 'RECOVERY_POSTGRES_PORT must be numeric' ;; esac

[ "$target_host_id" != "$production_host_id" ] || fail 'recovery target must not be the production host'
[ "$target_host_id" = "$isolated_restore_host_id" ] || fail 'recovery target host is not the configured isolated restore host'

if [ -n "$target_time" ] && [ -n "$target_lsn" ]; then
  usage
fi
if [ -z "$target_time" ] && [ -z "$target_lsn" ]; then
  usage
fi

if [ -n "$target_time" ]; then
  node --input-type=module -e 'if (Number.isNaN(Date.parse(process.argv[1]))) process.exit(2)' "$target_time" ||
    fail 'target time must be ISO-8601'
  recovery_type=time
  recovery_value="$target_time"
else
  [[ $target_lsn =~ ^[0-9A-Fa-f]+/[0-9A-Fa-f]+$ ]] || fail 'target LSN is invalid'
  recovery_type=lsn
  recovery_value="$target_lsn"
fi

case "$PGDATA_ROOT" in /var/lib/postgresql/16/recovery|/var/lib/postgresql/16/recovery/*) ;; *) fail 'RECOVERY_PGDATA_ROOT must be below /var/lib/postgresql/16/recovery' ;; esac
target_data_directory="${PGDATA_ROOT}/${recovery_id}"
[ ! -e "$target_data_directory" ] || fail 'execution-specific recovery data directory already exists'

if [ "${EUID}" -ne 0 ]; then
  fail 'must run as root after target safety validation succeeds'
fi

for command_name in "$PGBACKREST_BIN" "$PG_CTL_BIN" "$PSQL_BIN"; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is unavailable: ${command_name}"
done
id postgres >/dev/null 2>&1 || fail 'postgres system account is unavailable'

install -d -o postgres -g postgres -m 0700 "$PGDATA_ROOT"
install -d -o postgres -g postgres -m 0700 "$target_data_directory"

if ! runuser -u postgres -- "$PGBACKREST_BIN" \
  --stanza=edutrack \
  "--pg1-path=${target_data_directory}" \
  "--type=${recovery_type}" \
  "--target=${recovery_value}" \
  --target-action=pause \
  restore; then
  rmdir "$target_data_directory" 2>/dev/null || true
  fail 'pgBackRest restore did not complete'
fi

if ! runuser -u postgres -- "$PG_CTL_BIN" \
  -D "$target_data_directory" \
  -o "-p ${RECOVERY_PORT} -c listen_addresses=127.0.0.1" \
  -w start; then
  fail 'isolated PostgreSQL did not start'
fi

if ! runuser -u postgres -- "$PSQL_BIN" \
  "postgresql://127.0.0.1:${RECOVERY_PORT}/postgres" \
  -XAtqc 'SELECT pg_is_in_recovery()' | grep -Fxq t; then
  fail 'isolated PostgreSQL is not paused in recovery mode'
fi

printf '%s\n' "isolated recovery ${recovery_id} is paused on ${target_host_id}:${RECOVERY_PORT}; verify with target database ${target_database}"
