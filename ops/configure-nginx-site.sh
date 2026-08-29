#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

readonly DOMAIN="${1:-}"
readonly WWW_DOMAIN="www.${DOMAIN}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly TEMPLATE="$SCRIPT_DIR/nginx/precommunity-http.conf"
readonly GLOBAL_TEMPLATE="$SCRIPT_DIR/nginx/precommunity-http-global.conf"
readonly SITE_AVAILABLE=/etc/nginx/sites-available/precommunity
readonly SITE_ENABLED=/etc/nginx/sites-enabled/precommunity
readonly GLOBAL_CONFIG=/etc/nginx/conf.d/10-precommunity-security.conf

if [[ ! "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
  echo "Usage: $0 <fully-qualified-domain>" >&2
  exit 2
fi
if [[ "$DOMAIN" == www.* ]]; then
  echo "Pass the canonical domain without the www. prefix." >&2
  exit 2
fi
if [[ ! -f "$TEMPLATE" ]]; then
  echo "Nginx template is missing: $TEMPLATE" >&2
  exit 1
fi
if [[ ! -f "$GLOBAL_TEMPLATE" ]]; then
  echo "Nginx global template is missing: $GLOBAL_TEMPLATE" >&2
  exit 1
fi

rendered_site="$(mktemp)"
trap 'rm -f "$rendered_site"' EXIT
sed \
  -e "s/__DOMAIN__/${DOMAIN}/g" \
  -e "s/__WWW_DOMAIN__/${WWW_DOMAIN}/g" \
  "$TEMPLATE" >"$rendered_site"

sudo install -o root -g root -m 0644 "$GLOBAL_TEMPLATE" "$GLOBAL_CONFIG"
sudo install -o root -g root -m 0644 "$rendered_site" "$SITE_AVAILABLE"
sudo ln -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"
sudo nginx -t
sudo systemctl reload nginx

printf 'Configured Nginx HTTP virtual hosts for %s and %s.\n' "$DOMAIN" "$WWW_DOMAIN"
