#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly ROLE_SQL_PATH="${SCRIPT_DIRECTORY}/001_ops_readonly_roles.sql"
readonly VERIFIER_PATH="${SCRIPT_DIRECTORY}/verify-readonly-role.ts"
readonly EXPLORER_ROLE_SQL_PATH="${SCRIPT_DIRECTORY}/003_database_explorer_roles.sql"
readonly EXPLORER_VERIFIER_PATH="${SCRIPT_DIRECTORY}/verify-database-explorer-role.ts"
readonly PSQL_BIN="${PSQL_BIN:-psql}"

fail() {
  printf '%s\n' "apply-role-grants: $1" >&2
  exit 2
}

usage() {
  fail 'usage: apply-role-grants.sh [--role-type readonly|explorer] --database <name> --admin-pgpass-file <0600 path> ... --revoke-public-privileges'
}

require_mode_0600() {
  local path="$1"
  [ -f "$path" ] || fail "credential file does not exist: $path"
  [ ! -L "$path" ] || fail "credential file must not be a symlink: $path"
  local mode
  mode="$(stat -c '%a' -- "$path")"
  [ "$mode" = '600' ] || fail "credential file mode must be 0600: $path"
}

read_generated_password() {
  local path="$1"
  local value
  value="$(tr -d '\r\n' < "$path")"
  [[ "$value" =~ ^[A-Za-z0-9_-]{32,}$ ]] || fail "generated password must be at least 32 URL-safe characters: $path"
  printf '%s' "$value"
}

psql_set() {
  printf '\\set %s %s\n' "$1" "$2"
}

require_identifier() {
  local value="$1"
  [[ "$value" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || fail "invalid PostgreSQL identifier: $value"
}

require_fixture_relation() {
  [[ "$1" =~ ^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$ ]] || fail "fixture must be schema.table"
}

role_type='readonly'
target_id=''
database_name=''
admin_pgpass_file=''
read_login=''
read_password_file=''
cancel_login=''
cancel_password_file=''
business_schemas=''
schema_owner_role=''
readonly_database_url_file=''
fixture=''
fixture_column=''
safe_column=''
blocked_column=''
grants_file=''
retire_login=''
require_tls=true
revoke_public_privileges=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --role-type) role_type="${2:-}"; shift 2 ;;
    --target) target_id="${2:-}"; shift 2 ;;
    --database) database_name="${2:-}"; shift 2 ;;
    --admin-pgpass-file) admin_pgpass_file="${2:-}"; shift 2 ;;
    --read-login|--browser-login) read_login="${2:-}"; shift 2 ;;
    --read-password-file|--browser-password-file) read_password_file="${2:-}"; shift 2 ;;
    --cancel-login) cancel_login="${2:-}"; shift 2 ;;
    --cancel-password-file) cancel_password_file="${2:-}"; shift 2 ;;
    --business-schemas) business_schemas="${2:-}"; shift 2 ;;
    --schema-owner-role) schema_owner_role="${2:-}"; shift 2 ;;
    --readonly-database-url-file|--browser-database-url-file) readonly_database_url_file="${2:-}"; shift 2 ;;
    --fixture) fixture="${2:-}"; shift 2 ;;
    --fixture-column) fixture_column="${2:-}"; shift 2 ;;
    --safe-column) safe_column="${2:-}"; shift 2 ;;
    --blocked-column) blocked_column="${2:-}"; shift 2 ;;
    --grants-file) grants_file="${2:-}"; shift 2 ;;
    --retire-login) retire_login="${2:-}"; shift 2 ;;
    --require-tls) require_tls=true; shift ;;
    --revoke-public-privileges) revoke_public_privileges=true; shift ;;
    *) usage ;;
  esac
done

[ -n "$database_name" ] || usage
[ -n "$admin_pgpass_file" ] || usage
[ -n "$read_login" ] || usage
[ -n "$read_password_file" ] || usage
[ -n "$business_schemas" ] || usage
[ -n "$schema_owner_role" ] || usage
[ -n "$readonly_database_url_file" ] || usage
[ -n "$fixture" ] || usage
[ "$revoke_public_privileges" = true ] || fail '--revoke-public-privileges is required because PUBLIC grants can bypass a role policy'

require_identifier "$database_name"
require_identifier "$read_login"
require_identifier "$schema_owner_role"
require_fixture_relation "$fixture"

[[ "$role_type" == 'readonly' || "$role_type" == 'explorer' ]] || fail 'role type must be readonly or explorer'


IFS=',' read -r -a schema_list <<< "$business_schemas"
[ "${#schema_list[@]}" -gt 0 ] || fail 'at least one business schema is required'
for schema_name in "${schema_list[@]}"; do
  require_identifier "$schema_name"
  case "$schema_name" in _ops|pg_catalog|information_schema) fail "protected schema cannot be granted: $schema_name" ;; esac
done

require_mode_0600 "$admin_pgpass_file"
require_mode_0600 "$read_password_file"
require_mode_0600 "$readonly_database_url_file"

command -v "$PSQL_BIN" >/dev/null 2>&1 || fail "psql is unavailable: $PSQL_BIN"
command -v node >/dev/null 2>&1 || fail 'node is unavailable'

read_password="$(read_generated_password "$read_password_file")"

if [ "$role_type" = 'explorer' ]; then
  case "$target_id" in
    edutrack_production)
      expected_browser_login='ops_browser_edutrack'
      expected_database='edutrack_production'
      ;;
    ops)
      expected_browser_login='ops_browser_ops'
      expected_database='edutrack_ops'
      ;;
    *) fail '--target must be edutrack_production or ops' ;;
  esac
  [ "$read_login" = "$expected_browser_login" ] || fail "--browser-login must be $expected_browser_login for target $target_id"
  [ "$database_name" = "$expected_database" ] || fail "--database must be $expected_database for target $target_id"

  [ -r "$EXPLORER_ROLE_SQL_PATH" ] || fail "explorer role SQL is unavailable: $EXPLORER_ROLE_SQL_PATH"
  [ -r "$EXPLORER_VERIFIER_PATH" ] || fail "explorer verifier is unavailable: $EXPLORER_VERIFIER_PATH"

  effective_safe_column="${safe_column:-$fixture_column}"
  [ -n "$effective_safe_column" ] || fail '--safe-column or --fixture-column is required'
  require_identifier "$effective_safe_column"
  if [ -n "$blocked_column" ]; then
    require_identifier "$blocked_column"
  fi

  {
    psql_set ops_database_name "$database_name"
    psql_set ops_target_id "$target_id"
    psql_set ops_business_schemas "$business_schemas"
    psql_set ops_schema_owner_role "$schema_owner_role"
    psql_set ops_browser_login "$read_login"
    psql_set ops_browser_password "$read_password"
    psql_set ops_revoke_public_privileges true
    printf '\\i %s\n' "$EXPLORER_ROLE_SQL_PATH"
    if [ -n "$grants_file" ]; then
      [ -r "$grants_file" ] || fail "grants file does not exist: $grants_file"
      printf '\\i %s\n' "$grants_file"
    fi
  } | PGPASSFILE="$admin_pgpass_file" "$PSQL_BIN" --no-psqlrc --quiet --set ON_ERROR_STOP=1 --dbname="$database_name"

  verifier_args=(
    --database-url-file "$readonly_database_url_file"
    --fixture "$fixture"
    --safe-column "$effective_safe_column"
    --expected-database "$database_name"
    --expected-role "$read_login"
  )
  if [ -n "$blocked_column" ]; then
    verifier_args+=(--blocked-column "$blocked_column")
  fi
  if [ "$require_tls" = true ]; then
    verifier_args+=(--require-tls)
  fi

  node --experimental-strip-types "$EXPLORER_VERIFIER_PATH" "${verifier_args[@]}"

  if [ -n "$retire_login" ]; then
    require_identifier "$retire_login"
    [ "$retire_login" != "$read_login" ] || fail 'retire login must differ from the new browser login'

    active_sessions="$({
      psql_set ops_retire_login "$retire_login"
      printf "SELECT count(*) FROM pg_stat_activity WHERE usename = :'ops_retire_login' AND pid <> pg_backend_pid();\n"
    } | PGPASSFILE="$admin_pgpass_file" "$PSQL_BIN" --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 --dbname="$database_name")"
    active_sessions="$(tr -d '[:space:]' <<< "$active_sessions")"
    [ "$active_sessions" = '0' ] || fail "old login still has ${active_sessions} active session(s); retry retirement after they drain"

    {
      psql_set ops_retire_login "$retire_login"
      printf 'ALTER ROLE :"ops_retire_login" NOLOGIN;\n'
      printf 'REVOKE ops_database_browser FROM :"ops_retire_login";\n'
      printf 'REVOKE ops_readonly, ops_cancel, pg_signal_backend FROM :"ops_retire_login";\n'
    } | PGPASSFILE="$admin_pgpass_file" "$PSQL_BIN" --no-psqlrc --quiet --set ON_ERROR_STOP=1 --dbname="$database_name"
  fi

  printf '%s\n' 'Database explorer PostgreSQL roles were provisioned and passed verification.'
else
  # Default readonly console mode
  [ -n "$cancel_login" ] || usage
  [ -n "$cancel_password_file" ] || usage
  [ -n "$fixture_column" ] || usage
  require_identifier "$cancel_login"
  require_identifier "$fixture_column"
  [ "$read_login" != "$cancel_login" ] || fail 'read and cancel logins must be distinct'
  require_mode_0600 "$cancel_password_file"

  [ -r "$ROLE_SQL_PATH" ] || fail "role SQL is unavailable: $ROLE_SQL_PATH"
  [ -r "$VERIFIER_PATH" ] || fail "role verifier is unavailable: $VERIFIER_PATH"

  cancel_password="$(read_generated_password "$cancel_password_file")"

  {
    psql_set ops_database_name "$database_name"
    psql_set ops_business_schemas "$business_schemas"
    psql_set ops_schema_owner_role "$schema_owner_role"
    psql_set ops_read_login "$read_login"
    psql_set ops_read_password "$read_password"
    psql_set ops_cancel_login "$cancel_login"
    psql_set ops_cancel_password "$cancel_password"
    psql_set ops_revoke_public_privileges true
    printf '\\i %s\n' "$ROLE_SQL_PATH"
  } | PGPASSFILE="$admin_pgpass_file" "$PSQL_BIN" --no-psqlrc --quiet --set ON_ERROR_STOP=1 --dbname="$database_name"

  node --experimental-strip-types "$VERIFIER_PATH" \
    --database-url-file "$readonly_database_url_file" \
    --fixture "$fixture" \
    --fixture-column "$fixture_column" \
    --expected-database "$database_name"

  if [ -n "$retire_login" ]; then
    require_identifier "$retire_login"
    [ "$retire_login" != "$read_login" ] || fail 'retire login must differ from the new read login'
    [ "$retire_login" != "$cancel_login" ] || fail 'retire login must differ from the new cancel login'

    active_sessions="$({
      psql_set ops_retire_login "$retire_login"
      printf "SELECT count(*) FROM pg_stat_activity WHERE usename = :'ops_retire_login' AND pid <> pg_backend_pid();\n"
    } | PGPASSFILE="$admin_pgpass_file" "$PSQL_BIN" --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 --dbname="$database_name")"
    active_sessions="$(tr -d '[:space:]' <<< "$active_sessions")"
    [ "$active_sessions" = '0' ] || fail "old login still has ${active_sessions} active session(s); retry retirement after they drain"

    {
      psql_set ops_retire_login "$retire_login"
      printf 'ALTER ROLE :"ops_retire_login" NOLOGIN;\n'
      printf 'REVOKE ops_readonly, ops_cancel, pg_signal_backend FROM :"ops_retire_login";\n'
    } | PGPASSFILE="$admin_pgpass_file" "$PSQL_BIN" --no-psqlrc --quiet --set ON_ERROR_STOP=1 --dbname="$database_name"
  fi

  printf '%s\n' 'Ops PostgreSQL roles were provisioned and the new read login passed verification.'
fi
