#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "must run as root" >&2
  exit 1
fi

password_file="${OPS_MONITOR_PASSWORD_FILE:-}"
sql_file="${OPS_MONITOR_SQL_FILE:-/srv/edutrack-ops/current/deploy/provision-postgres-monitor.sql}"
if [[ -z "$password_file" || ! -f "$password_file" ]]; then
  echo "configured secret path is missing or unreadable" >&2
  exit 1
fi
if [[ ! -f "$sql_file" ]]; then
  echo "SQL file not found" >&2
  exit 1
fi

mode="$(stat -c '%a' "$password_file")"
if [[ "$mode" != "600" ]]; then
  echo "secret file must have mode 600" >&2
  exit 1
fi
password="$(<"$password_file")"
if [[ -z "$password" || "$password" == *$'\n'* ]]; then
  echo "secret file must contain one non-empty line" >&2
  exit 1
fi

database_name="${OPS_MONITOR_DATABASE_NAME:-edutrack}"
runuser -u postgres -- psql --dbname="$database_name" --set=ON_ERROR_STOP=1 --set="ops_monitor_password=$password" --file="$sql_file"
