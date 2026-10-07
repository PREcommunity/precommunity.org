#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

readonly RELEASE_DIR="${1:-}"
readonly APP_ROOT=/srv/precommunity
readonly ACTIVE_ENV=/etc/precommunity/app.env
readonly STAGED_ENV=/etc/precommunity/app.env.next
readonly DATA_ENV=/etc/precommunity/data-services.env
readonly NVM_DIR=/home/ubuntu/.nvm
readonly NODE_RUNTIME=/home/ubuntu/.local/bin/precommunity-node
readonly BACKUP_ROOT=/var/backups/precommunity/postgresql
readonly UNITS=(precommunity-web.service precommunity-api.service precommunity-worker.service)
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly MARKET_PHASE="${KEYWORD_MARKET_RELEASE_PHASE-active}"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/runtime-deployment-env.sh"

case "$RELEASE_DIR" in "$APP_ROOT"/releases/*) ;; *) echo 'Expected an existing production release directory.' >&2; exit 2 ;; esac
case "$MARKET_PHASE" in active|preopen) ;; *) echo 'KEYWORD_MARKET_RELEASE_PHASE must be active or preopen.' >&2; exit 2 ;; esac
if [[ "${PRECOMMUNITY_MAINTENANCE_CONFIRMED:-0}" != 1 ]]; then
  echo 'Operator must enable maintenance and set PRECOMMUNITY_MAINTENANCE_CONFIRMED=1.' >&2
  exit 2
fi
for unit in "${UNITS[@]}"; do
  if [[ "$(systemctl show "$unit" --property=ActiveState --value)" != inactive ||
        "$(systemctl show "$unit" --property=MainPID --value)" != 0 ]]; then
    echo "Operator must stop $unit and wait for its process to exit before migrating." >&2
    exit 1
  fi
done
for file in "$ACTIVE_ENV" "$STAGED_ENV" "$DATA_ENV" "$RELEASE_DIR/release-manifest.json" "$RELEASE_DIR/apps/worker/dist/check-keyword-market.js"; do
  [[ -r "$file" ]] || { echo "Missing required file: $file" >&2; exit 1; }
done
[[ -x "$NODE_RUNTIME" ]] || { echo 'Production Node runtime is missing.' >&2; exit 1; }
[[ -s "$NVM_DIR/nvm.sh" ]] || { echo 'Production Node environment is missing.' >&2; exit 1; }
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null
corepack enable
# A global lock prevents two different prepared releases from migrating together.
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 0750 "$APP_ROOT/locks"
exec 9>"$APP_ROOT/locks/keyword-market-release.lock"
flock -n 9 || { echo 'Another Keyword Market release is in progress.' >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$DATA_ENV"
source "$ACTIVE_ENV"
set +a
readonly PREVIOUS_RELEASE="$(readlink -f "$APP_ROOT/current")"
readonly PREVIOUS_NETWORK="$PRECOMMUNITY_NETWORK"
readonly PREVIOUS_ORIGIN="$WEB_ORIGIN"
readonly PREVIOUS_MARKET="$(runtime_deployment_value "$PRECOMMUNITY_NETWORK" ads_contract_address)"
readonly PRESERVED_FIELDS=(safe_address escrow_address escrow_deployment_block pre_address usdc_address initial_owner_address treasury_address chain_confirmations)
previous_values=()
for field in "${PRESERVED_FIELDS[@]}"; do
  previous_values+=("$(runtime_deployment_value "$PRECOMMUNITY_NETWORK" "$field")")
done
set -a
# shellcheck disable=SC1090
source "$STAGED_ENV"
set +a
if [[ "$PRECOMMUNITY_NETWORK" != "$PREVIOUS_NETWORK" || "$WEB_ORIGIN" != "$PREVIOUS_ORIGIN" ]]; then
  echo 'Keyword Market release must preserve the active network and origin.' >&2
  exit 1
fi
for ((i=0; i<${#PRESERVED_FIELDS[@]}; i++)); do
  if [[ "$(runtime_deployment_value "$PRECOMMUNITY_NETWORK" "${PRESERVED_FIELDS[$i]}")" != "${previous_values[$i]}" ]]; then
    echo "Keyword Market release must preserve ${PRESERVED_FIELDS[$i]}." >&2
    exit 1
  fi
done
market="$(runtime_deployment_value "$PRECOMMUNITY_NETWORK" ads_contract_address)"
market_block="$(runtime_deployment_value "$PRECOMMUNITY_NETWORK" ads_contract_deployment_block)"
if [[ ! "$market" =~ ^0x[a-fA-F0-9]{40}$ || "$market" =~ ^0x0{40}$ || ! "$market_block" =~ ^[1-9][0-9]*$ ]]; then
  echo 'A confirmed nonzero Keyword Market address and deployment block are required.' >&2
  exit 1
fi
if [[ -n "$PREVIOUS_MARKET" && ! "$PREVIOUS_MARKET" =~ ^0x0{40}$ && "${PREVIOUS_MARKET,,}" != "${market,,}" ]]; then
  echo 'Replacing a live market contract requires a separate withdrawal-preserving release.' >&2
  exit 1
fi

if [[ "$PRECOMMUNITY_NETWORK" != base ]]; then
  echo 'This controlled release targets the existing Base mainnet installation.' >&2
  exit 1
fi
"$NODE_RUNTIME" --input-type=module <<'NODE'
let database;
try { database = new URL(process.env.DATABASE_URL); }
catch { throw new Error('Controlled release requires the existing local production database'); }
if (!['localhost', '127.0.0.1'].includes(database.hostname) ||
    database.pathname !== '/precommunity' ||
    !['', '5432'].includes(database.port) ||
    !['public', null].includes(database.searchParams.get('schema'))) {
  throw new Error('Backup target must match the existing local precommunity/public database');
}
NODE
cd "$RELEASE_DIR"
readonly BACKUP_DIR="$BACKUP_ROOT/keyword-market-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -o root -g postgres -m 0750 "$BACKUP_DIR"
sudo cp -p "$ACTIVE_ENV" "$BACKUP_DIR/app.env"
printf '%s\n' "$PREVIOUS_RELEASE" | sudo tee "$BACKUP_DIR/previous-release" >/dev/null
sudo install -d -o postgres -g postgres -m 0700 "$BACKUP_DIR/database"
sudo -u postgres pg_dump --dbname=precommunity --format=custom --file="$BACKUP_DIR/database/precommunity.dump"
sudo -u postgres pg_restore --list "$BACKUP_DIR/database/precommunity.dump" >/dev/null
sudo sha256sum "$BACKUP_DIR/database/precommunity.dump" | sudo tee "$BACKUP_DIR/checksums.sha256" >/dev/null
readonly COUNTS_SQL='SELECT json_build_array((SELECT count(*) FROM "User"),(SELECT count(*) FROM "AdCampaign"),(SELECT count(*) FROM "AdCreativeRevision"),(SELECT count(*) FROM "AdReport"),(SELECT count(*) FROM "FundingGoal"),(SELECT count(*) FROM "CryptoContribution"))::text;'
before_counts="$(sudo -u postgres psql --dbname=precommunity -XAtc "$COUNTS_SQL")"
printf '%s\n' "$before_counts" | sudo tee "$BACKUP_DIR/content-counts.json" >/dev/null

database_changed=0
release_promoted=0
restore_database=''
restore_created=0
on_failure() {
  local status=$?
  if [[ "$restore_created" == 1 ]]; then
    sudo -u postgres dropdb "$restore_database" || true
  fi
  if (( status != 0 )); then
    printf 'Release failed. Verified backup: %s.\n' "$BACKUP_DIR" >&2
    if [[ "$database_changed" == 1 ]]; then
      echo 'The database may have changed. Keep maintenance active; do not run an incompatible old worker or restore a database based only on maintenance or the feature being disabled. Preserve on-chain activity and withdrawals with a compatible fix.' >&2
    fi
    if [[ "$release_promoted" == 1 ]]; then
      echo 'The prepared release was promoted; keep maintenance active and use a compatible fix that preserves indexing and withdrawals.' >&2
    fi
  fi
}
trap on_failure EXIT

# Verify actual restoration into a temporary database on the existing PostgreSQL
# service; never overwrite the production database during this check.
restore_database="precommunity_verify_$(date -u +%Y%m%d%H%M%S)_$$"
sudo -u postgres createdb --template=template0 "$restore_database"
restore_created=1
sudo -u postgres pg_restore --exit-on-error --no-owner --no-privileges --dbname="$restore_database" "$BACKUP_DIR/database/precommunity.dump"
restored_counts="$(sudo -u postgres psql --dbname="$restore_database" -XAtc "$COUNTS_SQL")"
if [[ "$before_counts" != "$restored_counts" ]]; then
  echo 'Backup restoration did not preserve the content counts; release remains stopped.' >&2
  exit 1
fi
sudo -u postgres dropdb "$restore_database"
restore_created=0

# Mark before attempting migration: even a failed deploy may have committed earlier migrations.
database_changed=1
pnpm db:deploy
pnpm db:seed
sudo -u postgres psql --dbname=precommunity -X --set=ON_ERROR_STOP=1 --command='UPDATE "CommunitySettings" SET "keywordMarketEnabled" = false;'
after_counts="$(sudo -u postgres psql --dbname=precommunity -XAtc "$COUNTS_SQL")"
if [[ "$before_counts" != "$after_counts" ]]; then
  echo 'Preserved user/campaign/creative/report/ledger counts changed; release remains stopped.' >&2
  exit 1
fi
"$NODE_RUNTIME" apps/worker/dist/backfill.js --phase "$MARKET_PHASE"
"$NODE_RUNTIME" apps/worker/dist/check-keyword-market.js --phase "$MARKET_PHASE" >"$RELEASE_DIR/keyword-market-readiness.json"
"$NODE_RUNTIME" --input-type=module - "$MARKET_PHASE" <<'NODE'
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('release-manifest.json', 'utf8'));
const ready = JSON.parse(readFileSync('keyword-market-readiness.json', 'utf8'));
const phase = process.argv[2];
if (ready.status !== 'READY' || ready.phase !== phase || ready.paused !== (phase === 'preopen')) {
  throw new Error(`Keyword Market ${phase} readiness was not confirmed`);
}
for (const key of ['abiSha256', 'artifactSha256', 'buildInfoId']) {
  if (ready[key] !== manifest.keywordMarket[key]) throw new Error(`Release artifact identity mismatch: ${key}`);
}
NODE
sudo install -o root -g "$(id -gn)" -m 0640 "$STAGED_ENV" "$ACTIVE_ENV"
release_promoted=1
bash "$RELEASE_DIR/ops/activate-release.sh" "$RELEASE_DIR"
for ((attempt=0; attempt<30; attempt++)); do
  if curl --fail --silent --max-time 5 http://127.0.0.1:4000/v1/health >/dev/null &&
     curl --fail --silent --max-time 5 http://127.0.0.1:3000/ >/dev/null; then
    break
  fi
  if (( attempt == 29 )); then echo 'API/web did not become ready; keep maintenance active.' >&2; exit 1; fi
  sleep 2
done
trap - EXIT
printf 'Prepared release activated; market phase %s, application feature remains disabled. Backup: %s\n' "$MARKET_PHASE" "$BACKUP_DIR"
if [[ "$MARKET_PHASE" == preopen ]]; then
  printf 'Operator: enable Keyword Market in admin, confirm SYNCED, then Safe unpause. Verify active readiness and the two-wallet flow before ending maintenance.\n'
else
  printf 'Operator: enable Keyword Market in admin, confirm SYNCED and active readiness, then verify the two-wallet flow before ending maintenance. The contract is already active on-chain.\n'
fi
