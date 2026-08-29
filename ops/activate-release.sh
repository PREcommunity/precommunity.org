#!/usr/bin/env bash

set -Eeuo pipefail

readonly RELEASE_DIR="${1:-}"
readonly RELEASES_ROOT=/srv/precommunity/releases
readonly APP_ROOT=/srv/precommunity
readonly CURRENT_LINK="$APP_ROOT/current"
readonly UNIT_SOURCE="$RELEASE_DIR/ops/systemd"
readonly UNITS=(precommunity-api.service precommunity-worker.service precommunity-web.service)

case "$RELEASE_DIR" in
  "$RELEASES_ROOT"/*) ;;
  *)
    echo "Usage: $0 /srv/precommunity/releases/<release-id>" >&2
    exit 2
    ;;
esac

for required_path in \
  "$RELEASE_DIR/apps/api/dist/main.js" \
  "$RELEASE_DIR/apps/worker/dist/main.js" \
  "$RELEASE_DIR/apps/web/.next/standalone/apps/web/server.js"; do
  if [[ ! -f "$required_path" ]]; then
    echo "Release artifact is missing: $required_path" >&2
    exit 1
  fi
done

for unit in "${UNITS[@]}"; do
  if [[ ! -f "$UNIT_SOURCE/$unit" ]]; then
    echo "Systemd unit is missing: $UNIT_SOURCE/$unit" >&2
    exit 1
  fi
  sudo install -o root -g root -m 0644 "$UNIT_SOURCE/$unit" "/etc/systemd/system/$unit"
done

sudo systemctl daemon-reload
sudo ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
sudo systemctl enable "${UNITS[@]}"

# Start dependencies first, then the frontend that consumes the API.
sudo systemctl restart precommunity-api.service
sudo systemctl restart precommunity-worker.service
sudo systemctl restart precommunity-web.service

printf 'Activated release %s.\n' "$RELEASE_DIR"
