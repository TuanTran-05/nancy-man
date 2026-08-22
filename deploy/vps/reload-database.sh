#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
if [[ ${APP_DB_RESET_CONFIRM:-} != edutrack ]]; then
  echo 'set APP_DB_RESET_CONFIRM=edutrack to replace the VPS database' >&2
  exit 2
fi

identity=$(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -qtAX -c \
  "SELECT current_database() || '|' || current_user")
if [[ ${identity} != 'edutrack|edutrack' ]]; then
  echo "refusing to reset unexpected database identity: ${identity}" >&2
  exit 2
fi

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public AUTHORIZATION edutrack;
GRANT ALL ON SCHEMA public TO edutrack;
SQL

DATABASE_URL="${DATABASE_URL}" bash /srv/edutrack/db/run-migrations.sh
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f /srv/edutrack/db/data.sql
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f /srv/edutrack/db/verify-schema.sql
psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f /srv/edutrack/db/verify-data.sql

echo 'VPS PostgreSQL reload and verification completed'
