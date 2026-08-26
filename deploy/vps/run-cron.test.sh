#!/usr/bin/env bash
set -Eeuo pipefail

test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/bin"
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
sed \
  -e 's#source /srv/edutrack/shared/.env#source "${EDUTRACK_ENV_FILE:-/srv/edutrack/shared/.env}"#' \
  -e 's#LOCK_DIR=/srv/edutrack/shared/locks#LOCK_DIR="${EDUTRACK_LOCK_DIR:-/srv/edutrack/shared/locks}"#' \
  "$repo_root/deploy/vps/run-cron.sh" >"$test_root/run-cron.sh"
chmod +x "$test_root/run-cron.sh"
cat >"$test_root/env" <<'EOF'
CRON_SECRET=test-secret
INTERNAL_API_BASE_URL=http://127.0.0.1:3000
EOF
cat >"$test_root/bin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ ${CRON_FAKE_MODE:-success} == success ]]; then
  printf '{"success":true}\n'
  exit 0
fi
printf 'simulated curl failure\n' >&2
exit 22
EOF
chmod +x "$test_root/bin/curl"

success_output=$(PATH="$test_root/bin:$PATH" EDUTRACK_ENV_FILE="$test_root/env" EDUTRACK_LOCK_DIR="$test_root/locks" CRON_FAKE_MODE=success bash "$test_root/run-cron.sh" /api/daily-maintenance 2>&1)
grep -Fq 'ops-cron job=daily-maintenance status=success' <<<"$success_output"

set +e
failure_output=$(PATH="$test_root/bin:$PATH" EDUTRACK_ENV_FILE="$test_root/env" EDUTRACK_LOCK_DIR="$test_root/locks" CRON_FAKE_MODE=failure bash "$test_root/run-cron.sh" /api/outbox-process 2>&1)
failure_status=$?
set -e
[[ $failure_status -eq 22 ]]
grep -Fq 'ops-cron job=outbox-process status=failure' <<<"$failure_output"

printf 'run-cron markers: PASS\n'
