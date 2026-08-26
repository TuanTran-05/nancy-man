#!/usr/bin/env bash
set -euo pipefail

readonly PGBACKREST_BIN="${PGBACKREST_BIN:-pgbackrest}"
readonly REPOSITORY_PATH="${PGBACKREST_REPOSITORY_PATH:-/var/lib/pgbackrest}"

fail() {
  printf '%s\n' "backup-host verification failed: $1" >&2
  exit 1
}

if [ "$#" -ne 1 ] || [ "$1" != '--json' ]; then
  fail 'usage: verify-backup-host.sh --json'
fi

host_id="${OPS_DR_BACKUP_HOST_ID:-}"
[ -n "$host_id" ] || fail 'OPS_DR_BACKUP_HOST_ID is required'

case "$host_id" in
  *[!A-Za-z0-9._-]* | '') fail 'host ID contains unsupported characters' ;;
esac

command -v "$PGBACKREST_BIN" >/dev/null 2>&1 || fail 'pgBackRest executable is unavailable'

if ! "$PGBACKREST_BIN" --stanza=edutrack info --output=json 2>/dev/null |
  node --input-type=module -e '
    import { existsSync, readdirSync, statSync } from "node:fs";

    const hostId = process.argv[1];
    const repositoryPath = process.argv[2];
    const input = await new Promise((resolve, reject) => {
      let source = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { source += chunk; });
      process.stdin.on("end", () => resolve(source));
      process.stdin.on("error", reject);
    });
    const entries = JSON.parse(input);
    const stanza = Array.isArray(entries) ? entries.find((entry) => entry?.name === "edutrack") : undefined;

    if (!stanza) {
      throw new Error("edutrack stanza not found");
    }

    const backups = Array.isArray(stanza.backup) ? stanza.backup : [];
    const latestFullStop = backups
      .filter((backup) => backup?.type === "full" && Number.isFinite(backup?.timestamp?.stop))
      .map((backup) => backup.timestamp.stop)
      .reduce((latest, stop) => Math.max(latest, stop), 0);

    const newestFileMtime = (path) => {
      if (!existsSync(path)) return 0;
      const stat = statSync(path);
      if (!stat.isDirectory()) return stat.mtimeMs;
      return readdirSync(path, { withFileTypes: true }).reduce(
        (latest, entry) => Math.max(latest, newestFileMtime(`${path}/${entry.name}`)),
        stat.mtimeMs
      );
    };
    const repositoryBytes = (path) => {
      if (!existsSync(path)) return 0;
      const stat = statSync(path);
      if (!stat.isDirectory()) return stat.size;
      return readdirSync(path, { withFileTypes: true }).reduce(
        (total, entry) => total + repositoryBytes(`${path}/${entry.name}`),
        0
      );
    };
    const latestWalMtime = newestFileMtime(`${repositoryPath}/archive`);

    process.stdout.write(`${JSON.stringify({
      hostId,
      stanza: "edutrack",
      status: stanza.status?.code === 0 ? "ok" : "degraded",
      latestFullAt: latestFullStop ? new Date(latestFullStop * 1000).toISOString() : null,
      latestWalAt: latestWalMtime ? new Date(latestWalMtime).toISOString() : null,
      repositoryBytes: repositoryBytes(repositoryPath)
    })}\n`);
  ' "$host_id" "$REPOSITORY_PATH"; then
  fail 'could not read bounded backup health from pgBackRest'
fi
