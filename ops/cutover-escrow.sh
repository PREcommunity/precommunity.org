#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

readonly RELEASE_DIR="${1:-}"
readonly RELEASES_ROOT=/srv/precommunity/releases
readonly NVM_DIR=/home/ubuntu/.nvm
readonly NODE_RUNTIME=/home/ubuntu/.local/bin/precommunity-node
readonly BACKUP_DIR=/var/backups/precommunity/postgresql
readonly ACTIVE_ENV_FILE=/etc/precommunity/app.env
readonly STAGED_ENV_FILE=/etc/precommunity/app.env.escrow-next
readonly UNITS=(precommunity-web.service precommunity-api.service precommunity-worker.service)
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/runtime-deployment-env.sh"

case "$RELEASE_DIR" in
  "$RELEASES_ROOT"/*) ;;
  *)
    echo "Usage: $0 /srv/precommunity/releases/<release-id>" >&2
    exit 2
    ;;
esac

for required_path in \
  "$RELEASE_DIR/package.json" \
  "$RELEASE_DIR/apps/api/dist/main.js" \
  "$RELEASE_DIR/apps/worker/dist/main.js" \
  "$RELEASE_DIR/apps/web/.next/standalone/apps/web/server.js"; do
  if [[ ! -f "$required_path" ]]; then
    echo "Release artifact is missing: $required_path" >&2
    exit 1
  fi
done
if [[ ! -r /etc/precommunity/data-services.env ||
  ! -r "$ACTIVE_ENV_FILE" ||
  ! -r "$STAGED_ENV_FILE" ]]; then
  echo 'The data, active and staged escrow environment files must all be readable.' >&2
  exit 1
fi
if [[ ! -s "$NVM_DIR/nvm.sh" || ! -x "$NODE_RUNTIME" ]]; then
  echo 'The production Node.js runtime is unavailable.' >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null
corepack enable

set -a
# shellcheck disable=SC1091
source /etc/precommunity/data-services.env
# Capture the retired deployment before loading the staged escrow manifest.
# shellcheck disable=SC1091
source "$ACTIVE_ENV_FILE"
set +a
readonly RETIRED_NETWORK="${PRECOMMUNITY_NETWORK:-}"
if [[ "$RETIRED_NETWORK" != base && "$RETIRED_NETWORK" != base-sepolia ]]; then
  echo 'The active escrow network must be base or base-sepolia.' >&2
  exit 1
fi
readonly RETIRED_RPC_URL="$(runtime_deployment_value "$RETIRED_NETWORK" rpc_url)"
readonly RETIRED_ESCROW_ADDRESS="$(runtime_deployment_value "$RETIRED_NETWORK" escrow_address)"
readonly RETIRED_ESCROW_DEPLOYMENT_BLOCK="$(runtime_deployment_value "$RETIRED_NETWORK" escrow_deployment_block)"
readonly RETIRED_PRE_ADDRESS="$(runtime_deployment_value "$RETIRED_NETWORK" pre_address)"
readonly RETIRED_USDC_ADDRESS="$(runtime_deployment_value "$RETIRED_NETWORK" usdc_address)"

set -a
# shellcheck disable=SC1091
source "$STAGED_ENV_FILE"
set +a

if [[ "${PRECOMMUNITY_NETWORK:-}" != base && "${PRECOMMUNITY_NETWORK:-}" != base-sepolia ]]; then
  echo 'The staged escrow network must be base or base-sepolia.' >&2
  exit 1
fi
readonly REPLACEMENT_ESCROW_ADDRESS="$(runtime_deployment_value "$PRECOMMUNITY_NETWORK" escrow_address)"
if [[ "$PRECOMMUNITY_NETWORK" == base ]]; then
  readonly CUTOVER_CHAIN_ID=8453
else
  readonly CUTOVER_CHAIN_ID=84532
fi
if [[ "$RETIRED_NETWORK" != "$PRECOMMUNITY_NETWORK" ]]; then
  echo 'The retired and replacement deployments must use the same network.' >&2
  exit 1
fi
if [[ -z "$RETIRED_RPC_URL" ]]; then
  echo 'The retired runtime does not define the RPC URL for its network.' >&2
  exit 1
fi
if [[ ! "$RETIRED_ESCROW_DEPLOYMENT_BLOCK" =~ ^[1-9][0-9]*$ ]]; then
  echo 'The retired runtime does not define a positive escrow deployment block.' >&2
  exit 1
fi
for address in \
  "$RETIRED_ESCROW_ADDRESS" \
  "$RETIRED_PRE_ADDRESS" \
  "$RETIRED_USDC_ADDRESS" \
  "$REPLACEMENT_ESCROW_ADDRESS"; do
  if [[ ! "$address" =~ ^0x[a-fA-F0-9]{40}$ || "$address" =~ ^0x0{40}$ ]]; then
    echo "Cutover received an invalid or zero deployment address: $address" >&2
    exit 1
  fi
done
if [[ "${RETIRED_ESCROW_ADDRESS,,}" == "${REPLACEMENT_ESCROW_ADDRESS,,}" ]]; then
  echo 'The replacement address must differ from the retired contract address.' >&2
  exit 1
fi

services_stopped=0
cutover_mutated=0
ledger_tmp_dir=''
readonly CUTOVER_BASHPID="$BASHPID"
recover_cutover() {
  if [[ "$BASHPID" != "$CUTOVER_BASHPID" ]]; then
    return
  fi
  [[ -z "$ledger_tmp_dir" ]] || rm -rf -- "$ledger_tmp_dir"
  if [[ "$services_stopped" == 1 && "$cutover_mutated" == 0 ]]; then
    sudo systemctl start "${UNITS[@]}" || true
  elif [[ "$services_stopped" == 1 ]]; then
    echo 'Cutover failed after the database changed; services remain stopped. Restore the verified backup before retrying.' >&2
  fi
}
trap recover_cutover ERR INT TERM EXIT

printf 'Stopping application services for the escrow cutover...\n'
sudo systemctl stop "${UNITS[@]}"
services_stopped=1

cd "$RELEASE_DIR"

printf 'Checking accounted balances on the retired escrow...\n'
RETIRED_NETWORK="$RETIRED_NETWORK" \
RETIRED_RPC_URL="$RETIRED_RPC_URL" \
RETIRED_ESCROW_ADDRESS="$RETIRED_ESCROW_ADDRESS" \
RETIRED_ESCROW_DEPLOYMENT_BLOCK="$RETIRED_ESCROW_DEPLOYMENT_BLOCK" \
RETIRED_PRE_ADDRESS="$RETIRED_PRE_ADDRESS" \
RETIRED_USDC_ADDRESS="$RETIRED_USDC_ADDRESS" \
"$NODE_RUNTIME" --input-type=module <<'NODE'
const expectedChainId = process.env.RETIRED_NETWORK === 'base' ? 8453 : 84532;
const rpcUrl = process.env.RETIRED_RPC_URL;
const escrow = process.env.RETIRED_ESCROW_ADDRESS;
const deploymentBlock = BigInt(process.env.RETIRED_ESCROW_DEPLOYMENT_BLOCK);
const tokens = [process.env.RETIRED_PRE_ADDRESS, process.env.RETIRED_USDC_ADDRESS];
const accountedByTokenSelector = '0x60d97996';
const goalCreatedTopic = '0xe06e4ad6c602fa1aec3bec461eae9596c48a424cb3e8df3dc93419c31a9bb460';

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error('Retired escrow RPC returned HTTP ' + response.status);
  const payload = await response.json();
  if (payload.error) throw new Error('Retired escrow RPC failed: ' + payload.error.message);
  return payload.result;
}

const chainId = Number(BigInt(await rpc('eth_chainId', [])));
if (chainId !== expectedChainId) throw new Error('Retired escrow RPC chain ID mismatch');
const code = await rpc('eth_getCode', [escrow, 'latest']);
if (!code || code === '0x') throw new Error('Retired escrow bytecode is missing');
for (const token of tokens) {
  const data = accountedByTokenSelector + token.slice(2).toLowerCase().padStart(64, '0');
  const accounted = BigInt(await rpc('eth_call', [{ to: escrow, data }, 'latest']));
  if (accounted !== 0n) {
    throw new Error('Retired escrow still accounts for ' + accounted + ' units of token ' + token);
  }
}

const latestBlock = BigInt(await rpc('eth_blockNumber', []));
if (deploymentBlock > latestBlock) throw new Error('Retired escrow deployment block is in the future');
const logRange = 2_000n;
for (let fromBlock = deploymentBlock; fromBlock <= latestBlock; fromBlock += logRange) {
  const toBlock = fromBlock + logRange - 1n > latestBlock
    ? latestBlock
    : fromBlock + logRange - 1n;
  const logs = await rpc('eth_getLogs', [{
    address: escrow,
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    topics: [goalCreatedTopic],
  }]);
  if (!Array.isArray(logs)) throw new Error('Retired escrow log query returned an invalid result');
  if (logs.length !== 0) {
    throw new Error('Retired escrow has GoalCreated logs and cannot be detached without review');
  }
}
console.log('Retired escrow has zero accounted PRE/USDC and no GoalCreated events.');
NODE

printf 'Verifying the exact escrow bytecode surface and manifest...\n'
pnpm --filter @precommunity/worker check-chain-source

printf 'Creating and verifying a final PostgreSQL backup...\n'
sudo systemctl start precommunity-postgres-backup.service
latest_backup="$(sudo find "$BACKUP_DIR" -maxdepth 1 -type f -name 'precommunity-*.dump' -print | sort | tail -1)"
if [[ -z "$latest_backup" ]]; then
  echo 'No PostgreSQL backup was created.' >&2
  exit 1
fi
sudo -u postgres pg_restore --list "$latest_backup" >/dev/null

printf 'Applying the escrow database migration...\n'
pnpm db:deploy
cutover_mutated=1
pnpm db:seed

ledger_tmp_dir="$(mktemp -d)"
ledger_tmp_path="$ledger_tmp_dir/public-ledger.json"
ledger_export_path="$BACKUP_DIR/precommunity-public-ledger-$(date -u +%Y%m%dT%H%M%SZ).json"
printf 'Exporting the retired public ledger...\n'
ESCROW_LEDGER_EXPORT_PATH="$ledger_tmp_path" \
RETIRED_ESCROW_ADDRESS="$RETIRED_ESCROW_ADDRESS" \
pnpm db:export-public-ledger
sudo install -o root -g root -m 0600 "$ledger_tmp_path" "$ledger_export_path"
sudo sha256sum "$latest_backup" "$ledger_export_path"

printf 'Running the guarded projection reset...\n'
ALLOW_ESCROW_CUTOVER_RESET="${CUTOVER_CHAIN_ID}:${REPLACEMENT_ESCROW_ADDRESS,,}" \
ESCROW_CUTOVER_BACKUP_VERIFIED=yes \
ESCROW_CUTOVER_LIABILITIES_VERIFIED=zero \
pnpm db:cutover-escrow

printf 'Backfilling the replacement escrow and reconciling both tokens before activation...\n'
pnpm worker:backfill

printf 'Promoting the staged escrow runtime and activating the release...\n'
sudo install -o root -g "$(id -gn)" -m 0640 "$STAGED_ENV_FILE" "$ACTIVE_ENV_FILE"
bash "$RELEASE_DIR/ops/activate-release.sh" "$RELEASE_DIR"
services_stopped=0
trap - ERR INT TERM EXIT
rm -rf -- "$ledger_tmp_dir"

printf 'Escrow cutover completed. Backup: %s; public ledger: %s.\n' \
  "$latest_backup" "$ledger_export_path"
printf 'Transfer ownership to Safe and synchronize confirmed goal managers before publishing new goals.\n'
