#!/usr/bin/env bash
set -euo pipefail

readonly PSQL_BIN="${PSQL_BIN:-psql}"
readonly STANDBY_DATABASE_URL="${OPS_DR_STANDBY_DATABASE_URL:-}"
readonly PRODUCTION_SYSTEM_ID="${OPS_DR_PRODUCTION_SYSTEM_ID:-}"

fail() {
  printf '%s\n' "replication check failed: $1" >&2
  exit 1
}

if [ "$#" -ne 1 ] || [ "$1" != '--json' ]; then
  fail 'usage: check-replication.sh --json'
fi

[ -n "$STANDBY_DATABASE_URL" ] || fail 'OPS_DR_STANDBY_DATABASE_URL is required'
[ -n "$PRODUCTION_SYSTEM_ID" ] || fail 'OPS_DR_PRODUCTION_SYSTEM_ID is required'
command -v "$PSQL_BIN" >/dev/null 2>&1 || fail 'psql is unavailable'

if ! "$PSQL_BIN" "$STANDBY_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "
  SELECT json_build_object(
    'inRecovery', pg_is_in_recovery(),
    'receiveLsn', pg_last_wal_receive_lsn()::text,
    'replayLsn', pg_last_wal_replay_lsn()::text,
    'replayLagSeconds', COALESCE(EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp()), 0),
    'systemIdentifier', (pg_control_system()).system_identifier::text,
    'archiveFallbackConfigured', current_setting('restore_command', true) <> ''
  )::text;
" 2>/dev/null |
  node --input-type=module -e '
    const expectedSystemId = process.argv[1];
    const source = await new Promise((resolve, reject) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { value += chunk; });
      process.stdin.on("end", () => resolve(value));
      process.stdin.on("error", reject);
    });
    const data = JSON.parse(source.trim());
    const healthy = data.inRecovery === true && data.systemIdentifier === expectedSystemId;
    process.stdout.write(`${JSON.stringify({
      status: healthy ? "ok" : "degraded",
      receiveLsn: data.receiveLsn,
      replayLsn: data.replayLsn,
      replayLagSeconds: Number(data.replayLagSeconds),
      archiveFallbackConfigured: data.archiveFallbackConfigured === true,
      systemIdentifier: data.systemIdentifier
    })}\n`);
    process.exitCode = healthy ? 0 : 2;
  ' "$PRODUCTION_SYSTEM_ID"; then
  fail 'could not produce replication health'
fi
