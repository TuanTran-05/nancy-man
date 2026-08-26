#!/usr/bin/env bash
set -euo pipefail

readonly CONFIG_PATH=/etc/pgbackrest/pgbackrest.conf
readonly REPOSITORY_PATH=/var/lib/pgbackrest
readonly LOG_PATH=/var/log/pgbackrest
readonly PGBACKREST_BIN="${PGBACKREST_BIN:-pgbackrest}"

fail() {
  printf '%s\n' "backup-host installation failed: $1" >&2
  exit 1
}

usage() {
  printf '%s\n' 'Usage: install-backup-host.sh --host-id <configured-backup-host-id>' >&2
  exit 64
}

if [ "${EUID}" -ne 0 ]; then
  fail 'must run as root'
fi

if [ "$#" -ne 2 ] || [ "$1" != '--host-id' ]; then
  usage
fi

host_id="$2"
expected_host_id="${OPS_DR_BACKUP_HOST_ID:-}"
credential_file="${OPS_DR_PGBACKREST_CREDENTIAL_FILE:-}"
package_version="${PGBACKREST_PACKAGE_VERSION:-}"
tls_ca_file="${OPS_DR_TLS_CA_FILE:-}"
ssh_public_key_file="${OPS_DR_BACKUP_SSH_PUBLIC_KEY_FILE:-}"

[ -n "$expected_host_id" ] || fail 'OPS_DR_BACKUP_HOST_ID is required'
[ "$host_id" = "$expected_host_id" ] || fail 'host ID does not match OPS_DR_BACKUP_HOST_ID'
[ -n "$credential_file" ] || fail 'OPS_DR_PGBACKREST_CREDENTIAL_FILE is required'
[ -r "$credential_file" ] || fail 'credential file is not readable by root'
[ -n "$package_version" ] || fail 'PGBACKREST_PACKAGE_VERSION is required'
[ -r "$tls_ca_file" ] || fail 'TLS CA file is not readable'
[ -r "$ssh_public_key_file" ] || fail 'SSH public-key file is not readable'

case "$host_id" in
  *[!A-Za-z0-9._-]* | '') fail 'host ID contains unsupported characters' ;;
esac

case "$package_version" in
  *[!0-9A-Za-z.+:~_-]* | '') fail 'package version contains unsupported characters' ;;
esac

if grep -Eq -- '-----BEGIN( [A-Z]+)? PRIVATE KEY-----' "$ssh_public_key_file"; then
  fail 'SSH key input must contain public keys only'
fi

if ! grep -Eq '^(ssh-|sk-ssh-|ecdsa-sha2-)' "$ssh_public_key_file"; then
  fail 'SSH public-key file contains no recognized public key'
fi

command -v apt-get >/dev/null 2>&1 || fail 'apt-get is required on the backup host'

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
  "pgbackrest=${package_version}"

if ! id pgbackrest >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/pgbackrest --shell /usr/sbin/nologin pgbackrest
fi

install -d -o pgbackrest -g pgbackrest -m 0700 "$REPOSITORY_PATH" "$LOG_PATH"
install -d -o root -g pgbackrest -m 0750 /etc/pgbackrest /etc/pgbackrest/conf.d
install -m 0644 "$tls_ca_file" /etc/pgbackrest/backup-host-ca.crt
install -m 0644 "$ssh_public_key_file" /etc/pgbackrest/backup-host-authorized-keys
install -o root -g pgbackrest -m 0640 \
  "$(dirname "$0")/pgbackrest/backup-host.conf.template" \
  "$CONFIG_PATH"

# The cipher value is read only at invocation time from a root-readable systemd
# credential file. It is never added to pgbackrest.conf or printed by this script.
run_pgbackrest() {
  local cipher_value
  cipher_value="$(<"$credential_file")"
  [ -n "$cipher_value" ] || fail 'credential file is empty'

  runuser -u pgbackrest -- env \
    "PGBACKREST_REPO1_CIPHER_PASS=${cipher_value}" \
    "$PGBACKREST_BIN" --stanza=edutrack "$@"
}

run_pgbackrest stanza-create
run_pgbackrest check

printf '%s\n' "backup host ${host_id} provisioned; run verify-backup-host.sh --json"
