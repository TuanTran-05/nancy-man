#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
set -a
# shellcheck disable=SC1091
source /srv/edutrack/shared/.env
set +a

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${POSTGRES_BACKUP_AGE_RECIPIENT:?POSTGRES_BACKUP_AGE_RECIPIENT is required}"
BACKUP_MODE=${POSTGRES_BACKUP_MODE:-}
BACKUP_DIR=${POSTGRES_BACKUP_DIR:-/srv/edutrack/shared/backups/postgres}
RETENTION_DAYS=${POSTGRES_BACKUP_RETENTION_DAYS:-14}
MAX_DISK_USAGE_PERCENT=${POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT:-85}
OFFSITE_REMOTE=${POSTGRES_BACKUP_RCLONE_REMOTE:-}

if [[ ${BACKUP_MODE} != 'local' && ${BACKUP_MODE} != 'offsite' ]]; then
  echo 'POSTGRES_BACKUP_MODE must be local or offsite' >&2
  exit 2
fi

case "${BACKUP_DIR}" in
  /srv/edutrack/shared/backups/*) ;;
  *)
    echo 'POSTGRES_BACKUP_DIR must stay under /srv/edutrack/shared/backups/' >&2
    exit 2
    ;;
esac
if [[ ! ${RETENTION_DAYS} =~ ^[0-9]+$ ]] || (( RETENTION_DAYS < 1 || RETENTION_DAYS > 365 )); then
  echo 'POSTGRES_BACKUP_RETENTION_DAYS must be an integer from 1 to 365' >&2
  exit 2
fi
if [[ ! ${MAX_DISK_USAGE_PERCENT} =~ ^[0-9]+$ ]] ||
  (( MAX_DISK_USAGE_PERCENT < 50 || MAX_DISK_USAGE_PERCENT > 95 )); then
  echo 'POSTGRES_BACKUP_MAX_DISK_USAGE_PERCENT must be an integer from 50 to 95' >&2
  exit 2
fi
if [[ ${BACKUP_MODE} == 'offsite' && ! ${OFFSITE_REMOTE} =~ ^[A-Za-z0-9._-]+:.+ ]]; then
  echo 'POSTGRES_BACKUP_RCLONE_REMOTE must use rclone remote:path syntax' >&2
  exit 2
fi
required_commands=(pg_dump pg_restore age sha256sum flock df find)
if [[ ${BACKUP_MODE} == 'offsite' ]]; then
  required_commands+=(rclone)
fi
for command_name in "${required_commands[@]}"; do
  command -v "${command_name}" >/dev/null || {
    echo "required command is missing: ${command_name}" >&2
    exit 2
  }
done

mkdir -p "${BACKUP_DIR}"
LOCK_FILE="${BACKUP_DIR}/.backup.lock"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo 'another PostgreSQL backup is already running' >&2
  exit 3
fi

disk_usage_percent() {
  df -P "${BACKUP_DIR}" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

disk_available_kib() {
  df -Pk "${BACKUP_DIR}" | awk 'NR == 2 { print $4 }'
}

DISK_USAGE_BEFORE=$(disk_usage_percent)
DISK_AVAILABLE_BEFORE_KIB=$(disk_available_kib)
if [[ ! ${DISK_USAGE_BEFORE} =~ ^[0-9]+$ ]]; then
  echo 'could not determine backup filesystem usage' >&2
  exit 3
fi
echo "$(date --iso-8601=seconds) backup_disk_usage_before_percent=${DISK_USAGE_BEFORE} backup_disk_available_before_kib=${DISK_AVAILABLE_BEFORE_KIB} limit_percent=${MAX_DISK_USAGE_PERCENT}"
if (( DISK_USAGE_BEFORE >= MAX_DISK_USAGE_PERCENT )); then
  echo "backup refused: filesystem usage is ${DISK_USAGE_BEFORE}% (limit ${MAX_DISK_USAGE_PERCENT}%)" >&2
  exit 3
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TMP_FILE="${BACKUP_DIR}/.edutrack-${STAMP}.dump.tmp"
FINAL_NAME="edutrack-${STAMP}.dump.age"
FINAL_FILE="${BACKUP_DIR}/${FINAL_NAME}"
CHECKSUM_FILE="${FINAL_FILE}.sha256"
trap 'rm -f "${TMP_FILE}" "${FINAL_FILE}.tmp"' EXIT

pg_dump \
  --dbname="${DATABASE_URL}" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file="${TMP_FILE}"
pg_restore --list "${TMP_FILE}" >/dev/null
age --recipient "${POSTGRES_BACKUP_AGE_RECIPIENT}" \
  --output "${FINAL_FILE}.tmp" "${TMP_FILE}"
rm -f "${TMP_FILE}"
mv "${FINAL_FILE}.tmp" "${FINAL_FILE}"
(
  cd "${BACKUP_DIR}"
  sha256sum "${FINAL_NAME}" >"${FINAL_NAME}.sha256"
  sha256sum -c "${FINAL_NAME}.sha256"
)

if [[ ${BACKUP_MODE} == 'offsite' ]]; then
  OFFSITE_ROOT=${OFFSITE_REMOTE%/}
  rclone copyto "${FINAL_FILE}" "${OFFSITE_ROOT}/${FINAL_NAME}"
  rclone copyto "${CHECKSUM_FILE}" "${OFFSITE_ROOT}/${FINAL_NAME}.sha256"
  rclone check "${BACKUP_DIR}" "${OFFSITE_ROOT}" \
    --include "${FINAL_NAME}" --include "${FINAL_NAME}.sha256" \
    --one-way --size-only
  VERIFIED_SCOPE='locally and offsite'
else
  VERIFIED_SCOPE='locally only'
  echo 'WARNING: backup mode is local; losing the VPS can destroy production and every backup' >&2
fi

find "${BACKUP_DIR}" -maxdepth 1 -type f \
  \( -name 'edutrack-*.dump.age' -o -name 'edutrack-*.dump.age.sha256' \) \
  -mmin "+$((RETENTION_DAYS * 1440))" -delete

DISK_USAGE_AFTER=$(disk_usage_percent)
DISK_AVAILABLE_AFTER_KIB=$(disk_available_kib)
if [[ ! ${DISK_USAGE_AFTER} =~ ^[0-9]+$ ]]; then
  echo 'backup completed but final filesystem usage could not be determined' >&2
  exit 3
fi
BACKUP_COUNT=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'edutrack-*.dump.age' | wc -l)
echo "$(date --iso-8601=seconds) backup_disk_usage_after_percent=${DISK_USAGE_AFTER} backup_disk_available_after_kib=${DISK_AVAILABLE_AFTER_KIB} backup_count=${BACKUP_COUNT} retention_days=${RETENTION_DAYS}"
if (( DISK_USAGE_AFTER >= MAX_DISK_USAGE_PERCENT )); then
  echo "backup completed but filesystem usage reached ${DISK_USAGE_AFTER}% (limit ${MAX_DISK_USAGE_PERCENT}%)" >&2
  exit 3
fi

trap - EXIT
echo "$(date --iso-8601=seconds) encrypted PostgreSQL backup verified ${VERIFIED_SCOPE}: ${FINAL_FILE}"
