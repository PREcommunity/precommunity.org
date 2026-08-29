#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

readonly RELEASE_DIR="${1:-}"
readonly RELEASES_ROOT=/srv/precommunity/releases
readonly NVM_DIR=/home/ubuntu/.nvm
readonly NODE_RUNTIME=/home/ubuntu/.local/bin/precommunity-node
readonly SKIP_DATABASE_DEPLOY="${PRECOMMUNITY_SKIP_DATABASE_DEPLOY:-0}"
readonly APP_ENV_FILE="${PRECOMMUNITY_APP_ENV_FILE:-/etc/precommunity/app.env}"

case "$RELEASE_DIR" in
  "$RELEASES_ROOT"/*) ;;
  *)
    echo "Usage: $0 /srv/precommunity/releases/<release-id>" >&2
    exit 2
    ;;
esac

if [[ ! -f "$RELEASE_DIR/package.json" ]]; then
  echo "Release directory does not contain package.json: $RELEASE_DIR" >&2
  exit 1
fi
if [[ ! -r /etc/precommunity/data-services.env || ! -r "$APP_ENV_FILE" ]]; then
  echo "The application environment files are missing or unreadable." >&2
  exit 1
fi
if [[ "$APP_ENV_FILE" != /etc/precommunity/app.env &&
  "$APP_ENV_FILE" != /etc/precommunity/app.env.mainnet-next &&
  "$APP_ENV_FILE" != /etc/precommunity/app.env.escrow-next ]]; then
  echo "Refusing to source an unexpected application environment path: $APP_ENV_FILE" >&2
  exit 2
fi
if [[ "$SKIP_DATABASE_DEPLOY" != 0 && "$SKIP_DATABASE_DEPLOY" != 1 ]]; then
  echo 'PRECOMMUNITY_SKIP_DATABASE_DEPLOY must be 0 or 1.' >&2
  exit 2
fi
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
  echo "NVM is not installed for the ubuntu user." >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null
corepack enable
install -d -m 0755 "$(dirname "$NODE_RUNTIME")"
ln -sfn "$(command -v node)" "$NODE_RUNTIME"
if [[ ! -x "$NODE_RUNTIME" ]]; then
  echo "The stable Node runtime link could not be created: $NODE_RUNTIME" >&2
  exit 1
fi

set -a
# Both files are generated locally on the VPS and contain shell-safe values.
# shellcheck disable=SC1091
source /etc/precommunity/data-services.env
# shellcheck disable=SC1090
source "$APP_ENV_FILE"
set +a

cd "$RELEASE_DIR"

printf 'Installing dependencies for %s...\n' "$RELEASE_DIR"
pnpm install --frozen-lockfile

printf 'Building API, worker and web application...\n'
pnpm build

# Next.js standalone output does not copy static assets automatically.
readonly STATIC_DEST="$RELEASE_DIR/apps/web/.next/standalone/apps/web/.next/static"
install -d -m 0755 "$STATIC_DEST"
rsync -a --delete "$RELEASE_DIR/apps/web/.next/static/" "$STATIC_DEST/"

if [[ "$SKIP_DATABASE_DEPLOY" == 1 ]]; then
  printf 'Database migrations are deferred to the controlled cutover.\n'
else
  printf 'Applying production database migrations...\n'
  pnpm db:deploy

  printf 'Ensuring the application project exists...\n'
  pnpm db:seed
fi

printf 'Release %s is built and migrated.\n' "$RELEASE_DIR"
