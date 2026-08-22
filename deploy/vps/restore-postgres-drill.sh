#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
if [[ $# -ne 2 ]]; then
  echo 'usage: restore-postgres-drill.sh <backup.dump.age> <isolated-target-database-url>' >&2
  exit 2
fi

BACKUP_FILE=$1
TARGET_DATABASE_URL=$2
: "${DATABASE_URL:?DATABASE_URL must identify the production database}"
: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE is required to decrypt the backup}"

if [[ ! -f ${BACKUP_FILE} ]] || [[ ! -f ${BACKUP_FILE}.sha256 ]]; then
  echo 'encrypted backup and matching .sha256 file are required' >&2
  exit 2
fi
if [[ ${TARGET_DATABASE_URL} == "${DATABASE_URL}" ]]; then
  echo 'restore target must not be the production DATABASE_URL' >&2
  exit 2
fi
for command_name in age pg_restore psql sha256sum; do
  command -v "${command_name}" >/dev/null || {
    echo "required command is missing: ${command_name}" >&2
    exit 2
  }
done

PRODUCTION_ID=$(psql "${DATABASE_URL}" -XAtqc \
  "select coalesce(inet_server_addr()::text, 'local') || ':' || inet_server_port() || '/' || current_database()")
TARGET_ID=$(psql "${TARGET_DATABASE_URL}" -XAtqc \
  "select coalesce(inet_server_addr()::text, 'local') || ':' || inet_server_port() || '/' || current_database()")
if [[ ${TARGET_ID} == "${PRODUCTION_ID}" ]]; then
  echo "restore target resolves to the production database: ${TARGET_ID}" >&2
  exit 2
fi

TARGET_TABLE_COUNT=$(psql "${TARGET_DATABASE_URL}" -XAtqc \
  "select count(*) from pg_catalog.pg_tables where schemaname not in ('pg_catalog', 'information_schema')")
if [[ ${TARGET_TABLE_COUNT} != 0 ]]; then
  echo 'restore drill target must be an empty database' >&2
  exit 2
fi

BACKUP_DIR=$(cd "$(dirname "${BACKUP_FILE}")" && pwd)
BACKUP_NAME=$(basename "${BACKUP_FILE}")
(
  cd "${BACKUP_DIR}"
  sha256sum --check "${BACKUP_NAME}.sha256"
)

PLAIN_DUMP=$(mktemp "${TMPDIR:-/tmp}/edutrack-restore-drill.XXXXXX.dump")
VERIFY_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/edutrack-restore-verify.XXXXXX.log")
trap 'rm -f "${PLAIN_DUMP}" "${VERIFY_OUTPUT}"' EXIT
age --decrypt --identity "${AGE_IDENTITY_FILE}" --output "${PLAIN_DUMP}" "${BACKUP_FILE}"
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname "${TARGET_DATABASE_URL}" "${PLAIN_DUMP}"

psql "${TARGET_DATABASE_URL}" -X -v ON_ERROR_STOP=1 -f db/verify-schema.sql | tee "${VERIFY_OUTPUT}"
psql "${TARGET_DATABASE_URL}" -X -v ON_ERROR_STOP=1 -f db/verify-data.sql | tee -a "${VERIFY_OUTPUT}"
if grep -Eq '(^|[^A-Z])FAIL([^A-Z]|$)' "${VERIFY_OUTPUT}"; then
  echo 'restore verification reported FAIL' >&2
  exit 1
fi

echo "restore drill passed on isolated target ${TARGET_ID}"
