#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo 'run as root' >&2
  exit 2
fi

if [[ $# -lt 1 ]]; then
  echo 'usage: activate-host.sh <domain-or-public-ip> [additional-domain ...]' >&2
  exit 2
fi
: "${CERTBOT_EMAIL:?set CERTBOT_EMAIL to the certificate owner address}"

SERVER_NAMES="$*"
PRIMARY_CERT_NAME=$1
CERTBOT_IDENTIFIERS=()
CERTBOT_PROFILE=()

is_ipv4() {
  local address=$1
  local octets=()
  local octet
  IFS=. read -r -a octets <<<"${address}"
  [[ ${#octets[@]} -eq 4 ]] || return 1
  for octet in "${octets[@]}"; do
    [[ ${octet} =~ ^[0-9]{1,3}$ ]] || return 1
    ((10#${octet} <= 255)) || return 1
  done
}

if is_ipv4 "${PRIMARY_CERT_NAME}"; then
  if [[ $# -ne 1 ]]; then
    echo 'an IP certificate must be requested separately from domain certificates' >&2
    exit 2
  fi
  CERTBOT_IDENTIFIERS+=(--ip-address "${PRIMARY_CERT_NAME}")
  CERTBOT_PROFILE+=(--preferred-profile shortlived)
else
  for domain in "$@"; do
    if [[ ! ${domain} =~ ^[A-Za-z0-9.-]+$ ]] || \
      [[ ${domain} != *.* ]] || [[ ${domain} == .* ]] || [[ ${domain} == *. ]] || \
      [[ ${domain} == -* ]] || [[ ${domain} == *- ]] || [[ ${domain} == *..* ]] || \
      [[ ${domain} == *.-* ]] || [[ ${domain} == *-.* ]]; then
      echo "invalid certificate domain: ${domain}" >&2
      exit 2
    fi
    CERTBOT_IDENTIFIERS+=(--domain "${domain}")
  done
fi
if [[ ! ${CERTBOT_EMAIL} =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo 'CERTBOT_EMAIL is invalid' >&2
  exit 2
fi
command -v certbot >/dev/null || {
  echo 'certbot is required' >&2
  exit 2
}
if is_ipv4 "${PRIMARY_CERT_NAME}"; then
  CERTBOT_VERSION=$(certbot --version 2>&1 | awk '{print $2}')
  if [[ ! ${CERTBOT_VERSION} =~ ^([0-9]+)\.([0-9]+) ]]; then
    echo "cannot parse Certbot version: ${CERTBOT_VERSION}" >&2
    exit 2
  fi
  CERTBOT_MAJOR=${BASH_REMATCH[1]}
  CERTBOT_MINOR=${BASH_REMATCH[2]}
  if ((CERTBOT_MAJOR < 5 || (CERTBOT_MAJOR == 5 && CERTBOT_MINOR < 4))); then
    echo 'IP certificates with webroot require Certbot 5.4 or newer' >&2
    exit 2
  fi
fi

if systemctl cat certbot.timer >/dev/null 2>&1; then
  CERTBOT_RENEWAL_TIMER=certbot.timer
elif systemctl cat snap.certbot.renew.timer >/dev/null 2>&1; then
  CERTBOT_RENEWAL_TIMER=snap.certbot.renew.timer
else
  echo 'no Certbot renewal timer was found' >&2
  exit 2
fi

install_certbot_tls_file() {
  local destination=$1
  local pattern=$2
  local source=''
  local search_root
  [[ -f ${destination} ]] && return 0
  for search_root in /snap/certbot /usr/lib/python3/dist-packages; do
    [[ -d ${search_root} ]] || continue
    source=$(find "${search_root}" -path "${pattern}" -print -quit 2>/dev/null || true)
    [[ -n ${source} ]] && break
  done
  if [[ -z ${source} ]]; then
    echo "cannot locate Certbot TLS support file for ${destination}" >&2
    exit 2
  fi
  install -m 0644 "${source}" "${destination}"
}

install_certbot_tls_file \
  /etc/letsencrypt/options-ssl-nginx.conf \
  '*/tls_configs/options-ssl-nginx.conf'
install_certbot_tls_file \
  /etc/letsencrypt/ssl-dhparams.pem \
  '*/ssl-dhparams.pem'

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
APP_CONFIG=${APP_CONFIG:-${SCRIPT_DIR}/nginx.conf}
BOOTSTRAP_CONFIG=${BOOTSTRAP_CONFIG:-${SCRIPT_DIR}/nginx-bootstrap.conf}
NGINX_CONFIG=/etc/nginx/sites-available/edutrack
NGINX_ENABLED=/etc/nginx/sites-enabled/edutrack
NGINX_DEFAULT=/etc/nginx/sites-enabled/default
CERTBOT_ROOT=/var/www/certbot
NGINX_BACKUP=$(mktemp /tmp/edutrack-nginx.XXXXXX)
HAD_NGINX_CONFIG=false
HAD_NGINX_ENABLED=false
DEFAULT_TARGET=''

if [[ -f ${NGINX_CONFIG} ]]; then
  cp --preserve=all "${NGINX_CONFIG}" "${NGINX_BACKUP}"
  HAD_NGINX_CONFIG=true
fi
if [[ -e ${NGINX_ENABLED} || -L ${NGINX_ENABLED} ]]; then
  HAD_NGINX_ENABLED=true
fi
if [[ -L ${NGINX_DEFAULT} ]]; then
  DEFAULT_TARGET=$(readlink "${NGINX_DEFAULT}")
fi

rollback_nginx() {
  local status=$?
  trap - ERR
  if [[ ${HAD_NGINX_CONFIG} == true ]]; then
    cp --preserve=all "${NGINX_BACKUP}" "${NGINX_CONFIG}"
  else
    rm -f "${NGINX_CONFIG}"
  fi
  if [[ ${HAD_NGINX_ENABLED} == true ]]; then
    ln -sfn "${NGINX_CONFIG}" "${NGINX_ENABLED}"
  else
    rm -f "${NGINX_ENABLED}"
  fi
  if [[ -n ${DEFAULT_TARGET} ]]; then
    ln -sfn "${DEFAULT_TARGET}" "${NGINX_DEFAULT}"
  fi
  nginx -t && systemctl reload nginx || true
  rm -f "${NGINX_BACKUP}"
  exit "${status}"
}
trap rollback_nginx ERR

install -d -m 0755 "${CERTBOT_ROOT}"
sed -e "s/REPLACE_WITH_DOMAIN/${SERVER_NAMES}/g" \
  "${BOOTSTRAP_CONFIG}" >"${NGINX_CONFIG}"

ln -sfn "${NGINX_CONFIG}" "${NGINX_ENABLED}"
nginx -t
systemctl reload nginx

certbot certonly \
  --webroot --webroot-path "${CERTBOT_ROOT}" \
  --non-interactive --agree-tos --keep-until-expiring \
  --email "${CERTBOT_EMAIL}" \
  "${CERTBOT_PROFILE[@]}" \
  "${CERTBOT_IDENTIFIERS[@]}"

systemctl enable --now "${CERTBOT_RENEWAL_TIMER}"

sed \
  -e "s/REPLACE_WITH_DOMAIN/${SERVER_NAMES}/g" \
  -e "s/REPLACE_WITH_CERT_NAME/${PRIMARY_CERT_NAME}/g" \
  "${APP_CONFIG}" >"${NGINX_CONFIG}"

rm -f "${NGINX_DEFAULT}"
nginx -t
systemctl reload nginx

env PATH=/usr/bin:/usr/local/bin pm2 startup systemd -u deploy --hp /home/deploy >/dev/null
trap - ERR
rm -f "${NGINX_BACKUP}"
echo 'TLS, automatic certificate renewal, Nginx and PM2 startup are active'
