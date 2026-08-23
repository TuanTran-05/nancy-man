#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "must run as root" >&2
  exit 1
fi

build_dir="${1:-}"
commit_id="${2:-$(date -u +%Y%m%d%H%M%S)}"
if [[ -z "$build_dir" || ! -d "$build_dir" ]]; then
  echo "usage: release-ops.sh <verified-build-dir> [commit]" >&2
  exit 1
fi
for required in dist/web/index.html dist/server/web-server.js dist/server/collector-main.js dist/server/failsafe-main.js dist/server/provision-ops-user.js; do
  [[ -f "$build_dir/$required" ]] || { echo "missing build artifact: $required" >&2; exit 1; }
done

groupadd --system --force edutrack-ops
if ! id -u edutrack-ops-web >/dev/null 2>&1; then useradd --system --no-create-home --shell /usr/sbin/nologin edutrack-ops-web; fi
usermod --append --groups edutrack-ops edutrack-ops-web
usermod --append --groups edutrack-ops deploy

install -d -o root -g edutrack-ops -m 2770 /srv/edutrack-ops /srv/edutrack-ops/releases /srv/edutrack-ops/shared /srv/edutrack-ops/shared/backups
release_dir="/srv/edutrack-ops/releases/$commit_id"
if [[ -e "$release_dir" ]]; then echo "release already exists" >&2; exit 1; fi
install -d -o root -g edutrack-ops -m 2750 "$release_dir"
cp -a "$build_dir/dist" "$release_dir/"
cp -a "$build_dir/deploy" "$release_dir/"
chown -R root:edutrack-ops "$release_dir"
find "$release_dir" -type d -exec chmod 2750 {} +
find "$release_dir" -type f -exec chmod 0640 {} +
chmod 0750 "$release_dir"/dist/server/*.js

link_tmp="/srv/edutrack-ops/.current.$commit_id"
ln -s "$release_dir" "$link_tmp"
mv -Tf "$link_tmp" /srv/edutrack-ops/current

install -d -o root -g edutrack-ops -m 0750 /etc/edutrack-ops
if [[ -n "${OPS_WEB_ENV_FILE:-}" ]]; then install -o root -g edutrack-ops -m 0640 "$OPS_WEB_ENV_FILE" /etc/edutrack-ops/web.env; fi
if [[ -n "${OPS_COLLECTOR_ENV_FILE:-}" ]]; then install -o root -g edutrack-ops -m 0640 "$OPS_COLLECTOR_ENV_FILE" /etc/edutrack-ops/collector.env; fi

systemctl daemon-reload
systemctl restart edutrack-ops-web.service
systemctl restart edutrack-ops-collector.service
echo "activated /srv/edutrack-ops/current -> $release_dir"
