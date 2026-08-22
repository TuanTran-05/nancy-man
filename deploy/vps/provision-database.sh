#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo 'run as root' >&2
  exit 2
fi

PASSWORD_FILE=/srv/edutrack/shared/.postgres-password
if [[ ! -s ${PASSWORD_FILE} ]]; then
  echo "missing ${PASSWORD_FILE}" >&2
  exit 2
fi
DB_PASSWORD=$(<"${PASSWORD_FILE}")

runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v db_password="${DB_PASSWORD}" <<'SQL'
SELECT format('CREATE ROLE edutrack LOGIN PASSWORD %L', :'db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'edutrack') \gexec
SELECT format('ALTER ROLE edutrack LOGIN PASSWORD %L', :'db_password') \gexec
SELECT 'CREATE DATABASE edutrack OWNER edutrack'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'edutrack') \gexec
SQL

runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d edutrack <<'SQL'
ALTER SCHEMA public OWNER TO edutrack;
GRANT ALL ON SCHEMA public TO edutrack;
SQL

rm -f "${PASSWORD_FILE}"
echo 'database role and database are ready'
