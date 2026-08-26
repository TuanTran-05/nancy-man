#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ $# -eq 2 ]] || { echo 'usage: restore-beszel-drill.sh <backup.age> <age-identity>' >&2; exit 2; }

artifact=$(realpath -e -- "$1")
identity=$(realpath -e -- "$2")
[[ -f ${artifact} && -f ${identity} ]] || { echo 'backup and identity must be regular files' >&2; exit 1; }
artifact_name=$(basename -- "${artifact}")
[[ ${artifact_name} =~ ^beszel-(daily|weekly)-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.age$ ]] || { echo 'invalid Beszel backup name' >&2; exit 1; }
[[ ${artifact} == /srv/beszel/shared/backups/${artifact_name} ]] || { echo 'backup must be under the Beszel backup directory' >&2; exit 1; }
sidecar=${artifact}.sha256
[[ -f ${sidecar} ]] || { echo 'missing backup checksum' >&2; exit 1; }
(cd "$(dirname -- "${artifact}")" && sha256sum -c "${artifact_name}.sha256")

restore_dir=$(mktemp -d /tmp/edutrack-beszel-restore.XXXXXX)
cleanup() {
  if [[ "${BESZEL_RESTORE_KEEP:-false}" != true && "${restore_dir:-}" == /tmp/edutrack-beszel-restore.* ]]; then
    rm -rf -- "${restore_dir}"
  fi
}
trap cleanup EXIT
mkdir "${restore_dir}/unpacked"
age --decrypt --identity "${identity}" --output "${restore_dir}/beszel.tar.gz" "${artifact}"
mapfile -t entries < <(tar -tzf "${restore_dir}/beszel.tar.gz")
[[ ${#entries[@]} -eq 4 ]] || { echo 'unexpected Beszel backup entries' >&2; exit 1; }
for entry in "${entries[@]}"; do
  [[ ${entry} == data.db || ${entry} == id_ed25519 || ${entry} == version.env || ${entry} == contents.sha256 ]] || { echo 'unexpected Beszel backup entry' >&2; exit 1; }
done
tar -xzf "${restore_dir}/beszel.tar.gz" -C "${restore_dir}/unpacked" --no-same-owner
(cd "${restore_dir}/unpacked" && sha256sum -c contents.sha256)
integrity=$(sqlite3 "${restore_dir}/unpacked/data.db" 'PRAGMA integrity_check;')
[[ ${integrity} == ok ]] || { echo 'restored Beszel database failed integrity check' >&2; exit 1; }
grep -Fxq 'BESZEL_VERSION=0.18.8' "${restore_dir}/unpacked/version.env"
[[ -s ${restore_dir}/unpacked/id_ed25519 ]]
printf 'restore_dir=%s\nintegrity=%s\n' "${restore_dir}" "${integrity}"
