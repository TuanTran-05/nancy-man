#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 || "$1" != /api/* ]]; then
  echo "usage: run-cron.sh /api/<route>" >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
source /srv/edutrack/shared/.env
set +a

: "${CRON_SECRET:?CRON_SECRET is required}"
BASE_URL=${INTERNAL_API_BASE_URL:-${PUBLIC_BASE_URL:-}}
: "${BASE_URL:?INTERNAL_API_BASE_URL or PUBLIC_BASE_URL is required}"

LOCK_DIR=/srv/edutrack/shared/locks
mkdir -p "${LOCK_DIR}"
LOCK_NAME=$(printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_')
exec 9>"${LOCK_DIR}/cron-${LOCK_NAME}.lock"
if ! flock -n 9; then
  echo "$(date --iso-8601=seconds) skip overlapping cron route $1"
  exit 0
fi

curl --fail --silent --show-error --max-time 900 \
  --connect-timeout 5 \
  --request POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${BASE_URL%/}$1"
