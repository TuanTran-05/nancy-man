#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

config=/etc/beszel/backup/backup.env
[[ -r ${config} ]] || { echo 'missing Beszel backup config' >&2; exit 1; }
# shellcheck disable=SC1090
source "${config}"
[[ ${BESZEL_BACKUP_AGE_RECIPIENT:-} =~ ^age1[[:alnum:]]+$ ]] || { echo 'invalid Beszel age recipient' >&2; exit 1; }

for command_name in sqlite3 age sha256sum tar flock find sort date install; do
  command -v "${command_name}" >/dev/null || { echo "missing command: ${command_name}" >&2; exit 1; }
done

data_dir=/srv/beszel/shared/hub/beszel_data
backup_dir=/srv/beszel/shared/backups
manifest=/srv/beszel/current/version.env
db=${data_dir}/data.db
private_key=${data_dir}/id_ed25519
[[ -f ${db} && -f ${private_key} && -f ${manifest} ]] || { echo 'missing Beszel backup input' >&2; exit 1; }
[[ -d ${backup_dir} && -w ${backup_dir} ]] || { echo 'Beszel backup directory is not writable' >&2; exit 1; }

work_dir=$(mktemp -d "${backup_dir}/.beszel-backup.XXXXXX")
cleanup() {
  if [[ "${work_dir:-}" == ${backup_dir}/.beszel-backup.* ]]; then
    rm -rf -- "${work_dir}"
  fi
}
trap cleanup EXIT
exec 9>"${backup_dir}/.backup.lock"
flock -n 9 || { echo 'Beszel backup already running' >&2; exit 1; }

sqlite3 "${db}" ".backup '${work_dir}/data.db'"
[[ $(sqlite3 "${work_dir}/data.db" 'PRAGMA integrity_check;') == ok ]] || { echo 'Beszel backup integrity check failed' >&2; exit 1; }
install -m 0600 "${private_key}" "${work_dir}/id_ed25519"
install -m 0600 "${manifest}" "${work_dir}/version.env"
(cd "${work_dir}" && sha256sum data.db id_ed25519 version.env > contents.sha256)
tar -C "${work_dir}" -czf "${work_dir}/beszel.tar.gz" data.db id_ed25519 version.env contents.sha256

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
daily_name=beszel-daily-${timestamp}.tar.gz.age
daily_path=${backup_dir}/${daily_name}
age --recipient "${BESZEL_BACKUP_AGE_RECIPIENT}" --output "${work_dir}/${daily_name}.tmp" "${work_dir}/beszel.tar.gz"
mv -Tf "${work_dir}/${daily_name}.tmp" "${daily_path}"

write_checksum() {
  local artifact=$1
  local name
  name=$(basename -- "${artifact}")
  printf '%s  %s\n' "$(sha256sum "${artifact}" | awk '{print $1}')" "${name}" > "${artifact}.sha256"
  (cd "${backup_dir}" && sha256sum -c "${name}.sha256")
}
write_checksum "${daily_path}"

if [[ $(date -u +%u) == 7 ]]; then
  weekly_name=beszel-weekly-${timestamp}.tar.gz.age
  weekly_path=${backup_dir}/${weekly_name}
  install -m 0600 "${daily_path}" "${weekly_path}"
  write_checksum "${weekly_path}"
fi

valid_artifact() {
  [[ $1 =~ ^beszel-(daily|weekly)-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.age$ ]]
}
prune_prefix() {
  local kind=$1
  local keep=$2
  local index=0
  while IFS= read -r name; do
    valid_artifact "${name}" || continue
    index=$((index + 1))
    if (( index > keep )); then
      unlink -- "${backup_dir}/${name}"
      [[ "${name}" != */* ]] || exit 1
      unlink -- "${backup_dir}/${name}.sha256"
    fi
  done < <(find "${backup_dir}" -maxdepth 1 -type f -printf '%f\n' | sort -r | grep -E "^beszel-${kind}-[0-9]{8}T[0-9]{6}Z\.tar\.gz\.age$" || true)
}
prune_prefix daily 7
prune_prefix weekly 4
echo "created ${daily_name}"
