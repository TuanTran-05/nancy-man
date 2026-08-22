#!/usr/bin/env bash
set -euo pipefail

readonly PGBACKREST_BIN="${PGBACKREST_BIN:-pgbackrest}"
readonly PGDATA="${PGDATA:-/var/lib/postgresql/16/main}"
readonly STANDBY_FRAGMENT_PATH="${STANDBY_FRAGMENT_PATH:-${PGDATA}/edutrack-standby.conf}"

fail() {
  printf '%s\n' "standby bootstrap failed: $1" >&2
  exit 2
}

if [ "$#" -ne 2 ] || [ "$1" != '--host-id' ]; then
  fail 'usage: bootstrap-standby.sh --host-id <configured-standby-host-id>'
fi

host_id="$2"
production_host_id="${OPS_DR_PRODUCTION_HOST_ID:-}"
standby_host_id="${OPS_DR_STANDBY_HOST_ID:-}"
tls_ca_file="${OPS_DR_TLS_CA_FILE:-}"
replication_dsn="${OPS_DR_REPLICATION_DSN:-}"

[ -n "$production_host_id" ] || fail 'OPS_DR_PRODUCTION_HOST_ID is required'
[ -n "$standby_host_id" ] || fail 'OPS_DR_STANDBY_HOST_ID is required'
[ -n "$replication_dsn" ] || fail 'OPS_DR_REPLICATION_DSN is required'
[ "$host_id" != "$production_host_id" ] || fail 'production host must not become a standby target'
[ "$host_id" = "$standby_host_id" ] || fail 'host ID does not match OPS_DR_STANDBY_HOST_ID'
[ -d "$PGDATA" ] || fail 'PostgreSQL data directory must exist and be empty before bootstrap'
[ -z "$(find "$PGDATA" -mindepth 1 -maxdepth 1 -print -quit)" ] ||
  fail 'PostgreSQL data directory must be empty before bootstrap'
[ -r "$tls_ca_file" ] || fail 'TLS CA file is missing or unreadable'

case "$host_id" in
  *[!A-Za-z0-9._-]* | '') fail 'host ID contains unsupported characters' ;;
esac

replication_host="$(
  node --input-type=module -e '
    const dsn = process.argv[1];
    const parsed = new URL(dsn);
    if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || !parsed.hostname) process.exit(2);
    process.stdout.write(parsed.hostname.toLowerCase());
  ' "$replication_dsn"
)" || fail 'replication URL is invalid'

if [[ ${replication_host} == "${standby_host_id,,}" ]]; then
  fail 'replication URL resolves to the standby host'
fi

if [[ ${replication_host} == "${production_host_id,,}" ]]; then
  :
elif command -v getent >/dev/null 2>&1; then
  standby_addresses=$(getent ahostsv4 "$standby_host_id" | awk '{print $1}' | sort -u || true)
  source_addresses=$(getent ahostsv4 "$replication_host" | awk '{print $1}' | sort -u || true)
  [ -n "$source_addresses" ] || fail 'replication URL host does not resolve'
  if [ -n "$standby_addresses" ] && grep -Fqx -f <(printf '%s\n' "$standby_addresses") \
    <(printf '%s\n' "$source_addresses") >/dev/null; then
    fail 'replication URL resolves to the standby host'
  fi
fi

if [ "${EUID}" -ne 0 ]; then
  fail 'must run as root after safety validation succeeds'
fi

command -v "$PGBACKREST_BIN" >/dev/null 2>&1 || fail 'pgBackRest is unavailable'
id postgres >/dev/null 2>&1 || fail 'postgres system account is unavailable'

install -d -o postgres -g postgres -m 0700 "$PGDATA"
install -d -o root -g postgres -m 0750 /etc/edutrack-dr
install -o root -g postgres -m 0640 "$tls_ca_file" /etc/edutrack-dr/primary-ca.crt

runuser -u postgres -- "$PGBACKREST_BIN" --stanza=edutrack --pg1-path="$PGDATA" restore
install -o postgres -g postgres -m 0600 /dev/null "$PGDATA/standby.signal"
sed "s/@PRIMARY_HOST@/${replication_host}/g" \
  "$(dirname "$0")/standby.fragment.conf" >"$STANDBY_FRAGMENT_PATH"
chown postgres:postgres "$STANDBY_FRAGMENT_PATH"
chmod 0600 "$STANDBY_FRAGMENT_PATH"

if ! grep -Fqx "include_if_exists = '$(basename "$STANDBY_FRAGMENT_PATH")'" \
  "$PGDATA/postgresql.auto.conf"; then
  printf "include_if_exists = '%s'\n" "$(basename "$STANDBY_FRAGMENT_PATH")" >>"$PGDATA/postgresql.auto.conf"
fi

printf '%s\n' "standby ${host_id} restored; start PostgreSQL and run check-replication.sh --json"
