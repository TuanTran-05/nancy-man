#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then echo "must run as root" >&2; exit 1; fi
host="${1:-}"
[[ "$host" == "man.thienuy.edu.vn" ]] || { echo "unexpected host" >&2; exit 1; }

release="/srv/edutrack-ops/current"
template="$release/deploy/nginx/man.thienuy.edu.vn.conf"
bootstrap="$release/deploy/nginx/bootstrap.conf"
available="/etc/nginx/sites-available/man.thienuy.edu.vn"
enabled="/etc/nginx/sites-enabled/man.thienuy.edu.vn"
webroot="/var/www/certbot"
backup="$(mktemp /etc/nginx/ops-vhost-backup.XXXXXX)"
had_previous=0
if [[ -e "$available" ]]; then cp -p "$available" "$backup"; had_previous=1; fi
rollback() {
  if [[ "$had_previous" -eq 1 ]]; then install -o root -g root -m 0644 "$backup" "$available"; else rm -f "$available"; fi
  ln -sfn "$available" "$enabled"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  rm -f "$backup"
}
trap rollback ERR

install -d -o root -g root -m 0755 "$webroot"
install -o root -g root -m 0644 "$bootstrap" "$available"
ln -sfn "$available" "$enabled"
nginx -t
systemctl reload nginx
certbot certonly --webroot -w "$webroot" --non-interactive --agree-tos --keep-until-expiring -d "$host"
install -o root -g root -m 0644 "$template" "$available"
nginx -t
systemctl reload nginx
trap - ERR
rm -f "$backup"
