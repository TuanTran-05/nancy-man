#!/usr/bin/env bash
set -euo pipefail

exec /usr/bin/node /srv/edutrack-ops/current/apps/api/dist/apps/api/src/cli/smoke-config-agent.js "$@"
