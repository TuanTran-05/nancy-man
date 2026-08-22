#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_TIMEZONE=${EXPECTED_TIMEZONE:-Asia/Ho_Chi_Minh}
for command_name in node npm nginx pm2 psql pg_dump pg_restore curl flock timedatectl certbot age; do
  command -v "${command_name}" >/dev/null || {
    echo "missing required command: ${command_name}" >&2
    exit 2
  }
done

NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])')
if (( NODE_MAJOR < 22 )); then
  echo "Node.js >= 22 is required; found $(node --version)" >&2
  exit 2
fi

ACTUAL_TIMEZONE=$(timedatectl show --property=Timezone --value)
if [[ ${ACTUAL_TIMEZONE} != "${EXPECTED_TIMEZONE}" ]]; then
  echo "VPS timezone must be ${EXPECTED_TIMEZONE}; found ${ACTUAL_TIMEZONE}" >&2
  exit 2
fi

nginx -t
echo "Host prerequisites passed: Node $(node --version), timezone ${ACTUAL_TIMEZONE}"
