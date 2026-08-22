#!/usr/bin/env bash
set -euo pipefail

readonly PGBACKREST_BIN="${PGBACKREST_BIN:-pgbackrest}"
readonly PSQL_BIN="${PSQL_BIN:-psql}"
readonly STATE_FILE="${ARCHIVE_CHECK_STATE_FILE:-/var/lib/edutrack-ops/dr/archive-check-state.json}"
readonly ARCHIVE_TIMEOUT_SECONDS="${OPS_DR_ARCHIVE_TIMEOUT_SECONDS:-60}"

fail() {
  printf '%s\n' "archive check failed: $1" >&2
  exit 1
}

if [ "$#" -ne 1 ] || [ "$1" != '--json' ]; then
  fail 'usage: archive-check.sh --json'
fi

case "$ARCHIVE_TIMEOUT_SECONDS" in
  *[!0-9]* | '') fail 'OPS_DR_ARCHIVE_TIMEOUT_SECONDS must be a whole number' ;;
esac

if [ "$ARCHIVE_TIMEOUT_SECONDS" -lt 1 ] || [ "$ARCHIVE_TIMEOUT_SECONDS" -gt 60 ]; then
  fail 'OPS_DR_ARCHIVE_TIMEOUT_SECONDS must be between 1 and 60'
fi

command -v "$PSQL_BIN" >/dev/null 2>&1 || fail 'psql is unavailable'
command -v "$PGBACKREST_BIN" >/dev/null 2>&1 || fail 'pgBackRest is unavailable'

if ! archive_statistics="$(
  "$PSQL_BIN" -X -A -t -v ON_ERROR_STOP=1 -c "
    SELECT json_build_object(
      'currentWalLsn', pg_current_wal_lsn()::text,
      'archivedCount', archived_count,
      'failedCount', failed_count,
      'lastArchivedAt', last_archived_time,
      'lastFailedAt', last_failed_time
    )::text
    FROM pg_stat_archiver;
  " 2>/dev/null
)"; then
  fail 'could not query pg_stat_archiver'
fi

if "$PGBACKREST_BIN" --stanza=edutrack check >/dev/null 2>&1; then
  pgbackrest_status=ok
else
  pgbackrest_status=failed
fi

printf '%s' "$archive_statistics" |
  node --input-type=module -e '
    import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
    import { dirname } from "node:path";

    const [timeoutInput, statePath, pgBackRestStatus] = process.argv.slice(1);
    const timeoutSeconds = Number(timeoutInput);
    const raw = await new Promise((resolve, reject) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { value += chunk; });
      process.stdin.on("end", () => resolve(value));
      process.stdin.on("error", reject);
    });
    const statistics = JSON.parse(raw.trim());
    const prior = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { failedCount: statistics.failedCount };
    const now = Date.now();
    const lastArchivedAt = Date.parse(statistics.lastArchivedAt);
    const lagSeconds = Number.isFinite(lastArchivedAt) ? Math.max(0, Math.floor((now - lastArchivedAt) / 1000)) : null;
    const failedCountDelta = Math.max(0, Number(statistics.failedCount) - Number(prior.failedCount ?? 0));
    let code = null;

    if (lagSeconds === null) code = "wal_archive_timestamp_invalid";
    else if (lagSeconds > timeoutSeconds) code = "wal_archive_lag";
    else if (failedCountDelta > 0) code = "wal_archive_failed";
    else if (pgBackRestStatus !== "ok") code = "pgbackrest_check_failed";

    mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
    const nextState = JSON.stringify({ failedCount: Number(statistics.failedCount), checkedAt: new Date(now).toISOString() });
    const temporaryStatePath = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporaryStatePath, nextState, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryStatePath, statePath);

    process.stdout.write(`${JSON.stringify({
      status: code ? "degraded" : "ok",
      code,
      lagSeconds,
      failedCountDelta,
      currentWalLsn: statistics.currentWalLsn,
      lastArchivedAt: Number.isFinite(lastArchivedAt) ? new Date(lastArchivedAt).toISOString() : null,
      checkedAt: new Date(now).toISOString()
    })}\n`);
    process.exitCode = code ? 2 : 0;
  ' "$ARCHIVE_TIMEOUT_SECONDS" "$STATE_FILE" "$pgbackrest_status"
