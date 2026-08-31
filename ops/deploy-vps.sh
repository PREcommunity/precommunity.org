#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly REPOSITORY_ENV_FILE="$REPO_ROOT/.env"

load_repository_env() {
  local env_file="$1"
  if [[ ! -f "$env_file" ]]; then
    return 0
  fi

  local -a deployment_variable_names=(
    PRECOMMUNITY_SSH_HOST
    PRECOMMUNITY_APP_USER
    PRECOMMUNITY_NETWORK
    PRECOMMUNITY_SAFE_ADDRESS
    SAFE_ADDRESS
    PRECOMMUNITY_BASE_RPC_URL
    BASE_RPC_URL
    PUBLIC_ESCROW_ADDRESS
    PUBLIC_ESCROW_DEPLOYMENT_BLOCK
    PUBLIC_PRE_ADDRESS
    PUBLIC_USDC_ADDRESS
    PUBLIC_INITIAL_OWNER_ADDRESS
    PUBLIC_TREASURY_ADDRESS
    PUBLIC_CHAIN_CONFIRMATIONS
    ADS_CONTRACT_ADDRESS
    ADS_CONTRACT_DEPLOYMENT_BLOCK
    PRECOMMUNITY_ESCROW_CUTOVER
    PRECOMMUNITY_RESET_DATABASE
    PRECOMMUNITY_WALLETCONNECT_PROJECT_ID
  )
  local -a preserved_names=()
  local -a preserved_values=()
  local variable_name
  for variable_name in "${deployment_variable_names[@]}"; do
    if [[ "${!variable_name+x}" == x ]]; then
      preserved_names+=("$variable_name")
      preserved_values+=("${!variable_name}")
    fi
  done

  local allexport_was_enabled=0
  if [[ "$-" == *a* ]]; then
    allexport_was_enabled=1
  else
    set -a
  fi
  # The repository .env is maintained as shell-compatible KEY=value assignments.
  # shellcheck disable=SC1090
  source "$env_file"
  if [[ "$allexport_was_enabled" == 0 ]]; then
    set +a
  fi

  local index
  for ((index = 0; index < ${#preserved_names[@]}; index++)); do
    printf -v "${preserved_names[$index]}" '%s' "${preserved_values[$index]}"
    export "${preserved_names[$index]}"
  done
}

load_repository_env "$REPOSITORY_ENV_FILE"
unset -f load_repository_env

readonly DOMAIN="${1:-}"
readonly SSH_HOST="${PRECOMMUNITY_SSH_HOST:-precommunity}"
readonly APP_USER="${PRECOMMUNITY_APP_USER:-ubuntu}"
readonly DEPLOYMENT_NETWORK="${PRECOMMUNITY_NETWORK:-base-sepolia}"
readonly DEPLOY_SAFE_ADDRESS="${PRECOMMUNITY_SAFE_ADDRESS:-${SAFE_ADDRESS:-}}"
readonly BASE_RPC_URL_OVERRIDE="${PRECOMMUNITY_BASE_RPC_URL:-${BASE_RPC_URL:-}}"
readonly ESCROW_ADDRESS="${PUBLIC_ESCROW_ADDRESS:-}"
readonly ESCROW_DEPLOYMENT_BLOCK="${PUBLIC_ESCROW_DEPLOYMENT_BLOCK:-}"
readonly PRE_ADDRESS="${PUBLIC_PRE_ADDRESS:-}"
readonly USDC_ADDRESS="${PUBLIC_USDC_ADDRESS:-}"
readonly INITIAL_OWNER_ADDRESS="${PUBLIC_INITIAL_OWNER_ADDRESS:-}"
readonly TREASURY_ADDRESS="${PUBLIC_TREASURY_ADDRESS:-}"
readonly CHAIN_CONFIRMATIONS="${PUBLIC_CHAIN_CONFIRMATIONS:-}"
readonly ADS_CONTRACT_ADDRESS_VALUE="${ADS_CONTRACT_ADDRESS:-}"
readonly ADS_CONTRACT_DEPLOYMENT_BLOCK_VALUE="${ADS_CONTRACT_DEPLOYMENT_BLOCK:-}"
readonly ESCROW_CUTOVER="${PRECOMMUNITY_ESCROW_CUTOVER:-0}"
readonly RESET_DATABASE="${PRECOMMUNITY_RESET_DATABASE:-0}"
readonly WALLETCONNECT_PROJECT_ID="${PRECOMMUNITY_WALLETCONNECT_PROJECT_ID:-}"
readonly RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)"
readonly RELEASE_DIR="/srv/precommunity/releases/$RELEASE_ID"

if [[ ! "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
  echo "Usage: $0 <fully-qualified-domain>" >&2
  exit 2
fi
if [[ ! "$APP_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "Invalid application user: $APP_USER" >&2
  exit 2
fi
if [[ "$DEPLOYMENT_NETWORK" != base-sepolia && "$DEPLOYMENT_NETWORK" != base ]]; then
  echo 'PRECOMMUNITY_NETWORK must be base-sepolia or base.' >&2
  exit 2
fi
if [[ -n "$DEPLOY_SAFE_ADDRESS" && ! "$DEPLOY_SAFE_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
  echo 'PRECOMMUNITY_SAFE_ADDRESS must be a 20-byte hexadecimal address.' >&2
  exit 2
fi
if [[ "$ESCROW_CUTOVER" != 0 && "$ESCROW_CUTOVER" != 1 ]]; then
  echo 'PRECOMMUNITY_ESCROW_CUTOVER must be 0 or 1.' >&2
  exit 2
fi
if [[ "$RESET_DATABASE" != 0 && "$RESET_DATABASE" != 1 ]]; then
  echo 'PRECOMMUNITY_RESET_DATABASE must be 0 or 1.' >&2
  exit 2
fi
if [[ "$RESET_DATABASE" == 1 && "$DEPLOYMENT_NETWORK" != base ]]; then
  echo 'A fresh database cutover is available only for a Base mainnet release.' >&2
  exit 2
fi
if [[ "$RESET_DATABASE" == 1 && "$ESCROW_CUTOVER" == 1 ]]; then
  echo 'The full database reset and guarded escrow cutover are mutually exclusive.' >&2
  exit 2
fi
if [[ -n "$WALLETCONNECT_PROJECT_ID" && ! "$WALLETCONNECT_PROJECT_ID" =~ ^[a-fA-F0-9]{32}$ ]]; then
  echo 'PRECOMMUNITY_WALLETCONNECT_PROJECT_ID must be a 32-character hexadecimal WalletConnect project ID.' >&2
  exit 2
fi

require_address() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^0x[a-fA-F0-9]{40}$ || "$value" =~ ^0x0{40}$ ]]; then
    printf '%s must be a non-zero 20-byte hexadecimal address.\n' "$name" >&2
    exit 2
  fi
}

require_address PUBLIC_ESCROW_ADDRESS "$ESCROW_ADDRESS"
require_address PUBLIC_PRE_ADDRESS "$PRE_ADDRESS"
require_address PUBLIC_USDC_ADDRESS "$USDC_ADDRESS"
require_address PUBLIC_INITIAL_OWNER_ADDRESS "$INITIAL_OWNER_ADDRESS"
require_address PUBLIC_TREASURY_ADDRESS "$TREASURY_ADDRESS"
if [[ ! "$ESCROW_DEPLOYMENT_BLOCK" =~ ^[1-9][0-9]*$ ]]; then
  echo 'PUBLIC_ESCROW_DEPLOYMENT_BLOCK must be a positive integer.' >&2
  exit 2
fi
if [[ -n "$CHAIN_CONFIRMATIONS" ]] &&
  { [[ ! "$CHAIN_CONFIRMATIONS" =~ ^[0-9]+$ ]] || (( CHAIN_CONFIRMATIONS < 1 || CHAIN_CONFIRMATIONS > 1000 )); }; then
  echo 'PUBLIC_CHAIN_CONFIRMATIONS must be an integer from 1 to 1000.' >&2
  exit 2
fi
if [[ -n "$ADS_CONTRACT_ADDRESS_VALUE" && ! "$ADS_CONTRACT_ADDRESS_VALUE" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
  echo 'ADS_CONTRACT_ADDRESS must be a 20-byte hexadecimal address.' >&2
  exit 2
fi
if [[ -n "$ADS_CONTRACT_DEPLOYMENT_BLOCK_VALUE" && ! "$ADS_CONTRACT_DEPLOYMENT_BLOCK_VALUE" =~ ^[0-9]+$ ]]; then
  echo 'ADS_CONTRACT_DEPLOYMENT_BLOCK must be a non-negative integer.' >&2
  exit 2
fi
if [[ -n "$ADS_CONTRACT_ADDRESS_VALUE" && -z "$ADS_CONTRACT_DEPLOYMENT_BLOCK_VALUE" ]] ||
  [[ -z "$ADS_CONTRACT_ADDRESS_VALUE" && -n "$ADS_CONTRACT_DEPLOYMENT_BLOCK_VALUE" ]]; then
  echo 'ADS_CONTRACT_ADDRESS and ADS_CONTRACT_DEPLOYMENT_BLOCK must be configured together.' >&2
  exit 2
fi

printf 'Creating release %s on %s...\n' "$RELEASE_ID" "$SSH_HOST"
ssh "$SSH_HOST" sudo install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$RELEASE_DIR"

rsync -az \
  --exclude=.git/ \
  --exclude=.DS_Store \
  --exclude=.env \
  --exclude=.env.local \
  --exclude=.pnpm-store/ \
  --exclude=node_modules/ \
  --exclude='**/dist/' \
  --exclude='apps/*/.next*/' \
  --exclude='apps/*/coverage/' \
  --exclude='apps/*/test-results/' \
  "$REPO_ROOT/" "$SSH_HOST:$RELEASE_DIR/"

runtime_env_file=/etc/precommunity/app.env
if [[ "$RESET_DATABASE" == 1 ]]; then
  runtime_env_file=/etc/precommunity/app.env.mainnet-next
elif [[ "$ESCROW_CUTOVER" == 1 ]]; then
  runtime_env_file=/etc/precommunity/app.env.escrow-next
fi
ssh "$SSH_HOST" env \
  "PRECOMMUNITY_NETWORK=$DEPLOYMENT_NETWORK" \
  "PRECOMMUNITY_ENV_FILE=$runtime_env_file" \
  "PRECOMMUNITY_SAFE_ADDRESS=$DEPLOY_SAFE_ADDRESS" \
  "PRECOMMUNITY_BASE_RPC_URL=$BASE_RPC_URL_OVERRIDE" \
  "PRECOMMUNITY_WALLETCONNECT_PROJECT_ID=$WALLETCONNECT_PROJECT_ID" \
  "PUBLIC_ESCROW_ADDRESS=$ESCROW_ADDRESS" \
  "PUBLIC_ESCROW_DEPLOYMENT_BLOCK=$ESCROW_DEPLOYMENT_BLOCK" \
  "PUBLIC_PRE_ADDRESS=$PRE_ADDRESS" \
  "PUBLIC_USDC_ADDRESS=$USDC_ADDRESS" \
  "PUBLIC_INITIAL_OWNER_ADDRESS=$INITIAL_OWNER_ADDRESS" \
  "PUBLIC_TREASURY_ADDRESS=$TREASURY_ADDRESS" \
  "PUBLIC_CHAIN_CONFIRMATIONS=$CHAIN_CONFIRMATIONS" \
  "ADS_CONTRACT_ADDRESS=$ADS_CONTRACT_ADDRESS_VALUE" \
  "ADS_CONTRACT_DEPLOYMENT_BLOCK=$ADS_CONTRACT_DEPLOYMENT_BLOCK_VALUE" \
  bash "$RELEASE_DIR/ops/configure-app-runtime.sh" "$DOMAIN"
skip_database_deploy=0
if [[ "$ESCROW_CUTOVER" == 1 || "$RESET_DATABASE" == 1 ]]; then
  skip_database_deploy=1
fi
ssh "$SSH_HOST" env \
  "PRECOMMUNITY_APP_ENV_FILE=$runtime_env_file" \
  "PRECOMMUNITY_SKIP_DATABASE_DEPLOY=$skip_database_deploy" \
  bash "$RELEASE_DIR/ops/build-release.sh" "$RELEASE_DIR"
if [[ "$RESET_DATABASE" == 1 ]]; then
  ssh "$SSH_HOST" bash "$RELEASE_DIR/ops/cutover-fresh-database.sh" "$RELEASE_DIR"
elif [[ "$ESCROW_CUTOVER" == 1 ]]; then
  ssh "$SSH_HOST" bash "$RELEASE_DIR/ops/cutover-escrow.sh" "$RELEASE_DIR"
else
  ssh "$SSH_HOST" bash "$RELEASE_DIR/ops/activate-release.sh" "$RELEASE_DIR"
fi

printf 'Release %s is active. Verify https://%s, indexer reconciliation and Safe authorities.\n' "$RELEASE_ID" "$DOMAIN"
