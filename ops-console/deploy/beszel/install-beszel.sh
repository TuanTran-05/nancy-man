#!/usr/bin/env bash
set -Eeuo pipefail
umask 027
[[ $(id -u) -eq 0 ]] || { echo 'must run as root' >&2; exit 1; }
[[ $(uname -m) == x86_64 ]] || { echo 'Beszel manifest is pinned for x86_64' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
manifest=${script_dir}/version.env
[[ -f ${manifest} ]] || { echo 'missing version manifest' >&2; exit 1; }
while IFS= read -r line; do
  [[ ${line} =~ ^BESZEL_[A-Z0-9_]+=[A-Za-z0-9._-]+$ ]] || { echo 'invalid manifest line' >&2; exit 1; }
done < "${manifest}"
# shellcheck disable=SC1090
source "${manifest}"

for command_name in curl sha256sum tar install useradd groupadd id uname systemctl; do
  command -v "${command_name}" >/dev/null || { echo "missing command: ${command_name}" >&2; exit 1; }
done

install_tmp=$(mktemp -d /tmp/edutrack-beszel-install.XXXXXX)
cleanup() {
  if [[ "${install_tmp:-}" == /tmp/edutrack-beszel-install.* ]]; then
    rm -rf -- "${install_tmp}"
  fi
}
trap cleanup EXIT

hub_archive=${install_tmp}/${BESZEL_HUB_ARCHIVE}
agent_archive=${install_tmp}/${BESZEL_AGENT_ARCHIVE}
curl -fL --retry 3 --proto '=https' --tlsv1.2 -o "${hub_archive}" "https://github.com/henrygd/beszel/releases/download/v${BESZEL_VERSION}/${BESZEL_HUB_ARCHIVE}"
curl -fL --retry 3 --proto '=https' --tlsv1.2 -o "${agent_archive}" "https://github.com/henrygd/beszel/releases/download/v${BESZEL_VERSION}/${BESZEL_AGENT_ARCHIVE}"
printf '%s  %s\n' "${BESZEL_HUB_SHA256}" "${hub_archive}" > "${install_tmp}/hub.sha256"
printf '%s  %s\n' "${BESZEL_AGENT_SHA256}" "${agent_archive}" > "${install_tmp}/agent.sha256"
sha256sum -c "${install_tmp}/hub.sha256"
sha256sum -c "${install_tmp}/agent.sha256"

hub_entries=$(tar -tzf "${hub_archive}" | awk '$0 == "beszel" || $0 == "./beszel" { count++ } END { print count + 0 }')
agent_entries=$(tar -tzf "${agent_archive}" | awk '$0 == "beszel-agent" || $0 == "./beszel-agent" { count++ } END { print count + 0 }')
[[ ${hub_entries} -eq 1 && ${agent_entries} -eq 1 ]] || { echo 'unexpected Beszel archive contents' >&2; exit 1; }

if ! getent group beszel-hub >/dev/null; then groupadd --system beszel-hub; fi
if ! id -u beszel-hub >/dev/null 2>&1; then useradd --system --no-create-home --shell /usr/sbin/nologin --gid beszel-hub beszel-hub; fi
if ! getent group beszel-agent >/dev/null; then groupadd --system beszel-agent; fi
if ! id -u beszel-agent >/dev/null 2>&1; then useradd --system --no-create-home --shell /usr/sbin/nologin --gid beszel-agent beszel-agent; fi

install -d -o root -g root -m 0755 /srv/beszel /srv/beszel/releases /etc/beszel
install -d -o beszel-hub -g beszel-hub -m 0700 /srv/beszel/shared/hub /srv/beszel/shared/backups
install -d -o beszel-agent -g beszel-agent -m 0700 /srv/beszel/shared/agent
install -d -o root -g beszel-hub -m 0750 /etc/beszel/hub /etc/beszel/backup
install -d -o root -g beszel-agent -m 0750 /etc/beszel/agent
release_dir=/srv/beszel/releases/${BESZEL_RELEASE_DIR}
[[ ! -e ${release_dir} ]] || { echo "release already exists: ${release_dir}" >&2; exit 1; }
release_tmp=${install_tmp}/release
install -d -o root -g root -m 0755 "${release_tmp}"
tar -xzf "${hub_archive}" -C "${release_tmp}" --no-same-owner
tar -xzf "${agent_archive}" -C "${release_tmp}" --no-same-owner
[[ -f ${release_tmp}/beszel && -f ${release_tmp}/beszel-agent ]] || { echo 'missing expected Beszel executable' >&2; exit 1; }
install -d -o root -g root -m 0755 "${release_dir}"
install -o root -g root -m 0755 "${release_tmp}/beszel" "${release_dir}/beszel"
install -o root -g root -m 0755 "${release_tmp}/beszel-agent" "${release_dir}/beszel-agent"
install -o root -g root -m 0644 "${script_dir}/LICENSE" "${release_dir}/LICENSE"
install -o root -g root -m 0644 "${manifest}" "${release_dir}/version.env"

link_tmp=/srv/beszel/.current.${BESZEL_RELEASE_DIR}
[[ ! -e ${link_tmp} && ! -L ${link_tmp} ]] || { echo "temporary current link exists: ${link_tmp}" >&2; exit 1; }
ln -s "${release_dir}" "${link_tmp}"
mv -Tf "${link_tmp}" /srv/beszel/current

install -o root -g root -m 0644 "${script_dir}/../systemd/beszel-hub.service" /etc/systemd/system/beszel-hub.service
install -o root -g root -m 0644 "${script_dir}/../systemd/beszel-agent.service" /etc/systemd/system/beszel-agent.service
install -o root -g root -m 0644 "${script_dir}/../systemd/beszel-backup.service" /etc/systemd/system/beszel-backup.service
install -o root -g root -m 0644 "${script_dir}/../systemd/beszel-backup.timer" /etc/systemd/system/beszel-backup.timer
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 "${script_dir}/backup-beszel.sh" /usr/local/libexec/edutrack-backup-beszel
install -o root -g root -m 0755 "${script_dir}/restore-beszel-drill.sh" /usr/local/libexec/edutrack-restore-beszel-drill
install -o root -g beszel-hub -m 0640 "${script_dir}/hub.env.example" /etc/beszel/hub/hub.env.example
install -o root -g beszel-agent -m 0640 "${script_dir}/agent.env.example" /etc/beszel/agent/agent.env.example
install -o root -g beszel-hub -m 0640 "${script_dir}/backup.env.example" /etc/beszel/backup/backup.env.example
systemctl daemon-reload
echo "installed Beszel ${BESZEL_VERSION} at ${release_dir}; services remain stopped"
