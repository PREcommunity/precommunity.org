#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

readonly DOMAIN="${1:-}"
readonly APP_USER="${PRECOMMUNITY_APP_USER:-ubuntu}"
readonly DEPLOYMENT_NETWORK="${PRECOMMUNITY_NETWORK:-base-sepolia}"
readonly SAFE_ADDRESS="${PRECOMMUNITY_SAFE_ADDRESS:-}"
readonly BASE_RPC_URL_OVERRIDE="${PRECOMMUNITY_BASE_RPC_URL:-}"
readonly ESCROW_ADDRESS="${PUBLIC_ESCROW_ADDRESS:-}"
readonly ESCROW_DEPLOYMENT_BLOCK="${PUBLIC_ESCROW_DEPLOYMENT_BLOCK:-}"
readonly PRE_ADDRESS="${PUBLIC_PRE_ADDRESS:-}"
readonly USDC_ADDRESS="${PUBLIC_USDC_ADDRESS:-}"
readonly INITIAL_OWNER_ADDRESS="${PUBLIC_INITIAL_OWNER_ADDRESS:-}"
readonly TREASURY_ADDRESS="${PUBLIC_TREASURY_ADDRESS:-}"
readonly CHAIN_CONFIRMATIONS="${PUBLIC_CHAIN_CONFIRMATIONS:-}"
readonly ADS_CONTRACT_ADDRESS_VALUE="${ADS_CONTRACT_ADDRESS:-}"
readonly ADS_CONTRACT_DEPLOYMENT_BLOCK_VALUE="${ADS_CONTRACT_DEPLOYMENT_BLOCK:-}"
readonly CONFIG_DIR=/etc/precommunity
readonly SECRET_FILE="${CONFIG_DIR}/app.secrets"
readonly ACTIVE_ENV_FILE="${CONFIG_DIR}/app.env"
readonly ENV_FILE="${PRECOMMUNITY_ENV_FILE:-$ACTIVE_ENV_FILE}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/runtime-deployment-env.sh"

if [[ ! "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; then
  echo "Usage: $0 <fully-qualified-domain>" >&2
  exit 2
fi
if ! getent passwd "$APP_USER" >/dev/null; then
  echo "Application user '$APP_USER' does not exist." >&2
  exit 1
fi
if [[ "$DEPLOYMENT_NETWORK" != base-sepolia && "$DEPLOYMENT_NETWORK" != base ]]; then
  echo 'PRECOMMUNITY_NETWORK must be base-sepolia or base.' >&2
  exit 2
fi
if [[ "$ENV_FILE" != "$ACTIVE_ENV_FILE" &&
  "$ENV_FILE" != "${CONFIG_DIR}/app.env.mainnet-next" &&
  "$ENV_FILE" != "${CONFIG_DIR}/app.env.escrow-next" ]]; then
  echo "Refusing to write an unexpected application environment path: $ENV_FILE" >&2
  exit 2
fi
if [[ -n "$SAFE_ADDRESS" && ! "$SAFE_ADDRESS" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
  echo 'PRECOMMUNITY_SAFE_ADDRESS must be a 20-byte hexadecimal address.' >&2
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
readonly APP_GROUP="$(id -gn "$APP_USER")"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
else
  sudo -v
  SUDO=(sudo)
fi

run_root() {
  "${SUDO[@]}" "$@"
}

run_root install -d -o root -g "$APP_GROUP" -m 0750 "$CONFIG_DIR"
if ! run_root test -f "$SECRET_FILE"; then
  session_secret="$(openssl rand -hex 48)"
  ads_report_fingerprint_secret="$(openssl rand -hex 48)"
  secret_tmp="$(mktemp)"
  trap 'rm -f "${secret_tmp:-}" "${env_tmp:-}"' EXIT
  printf "SESSION_SECRET='%s'\nADS_REPORT_FINGERPRINT_SECRET='%s'\n" \
    "$session_secret" "$ads_report_fingerprint_secret" >"$secret_tmp"
  run_root install -o root -g root -m 0600 "$secret_tmp" "$SECRET_FILE"
  rm -f "$secret_tmp"
fi

# The file contains only a shell-safe hexadecimal value generated above.
# shellcheck disable=SC1090
source <(run_root cat "$SECRET_FILE")
: "${SESSION_SECRET:?Missing SESSION_SECRET}"
if [[ -z "${ADS_REPORT_FINGERPRINT_SECRET:-}" ]]; then
  ADS_REPORT_FINGERPRINT_SECRET="$(openssl rand -hex 48)"
  secret_tmp="$(mktemp)"
  trap 'rm -f "${secret_tmp:-}" "${env_tmp:-}"' EXIT
  printf "SESSION_SECRET='%s'\nADS_REPORT_FINGERPRINT_SECRET='%s'\n" \
    "$SESSION_SECRET" "$ADS_REPORT_FINGERPRINT_SECRET" >"$secret_tmp"
  run_root install -o root -g root -m 0600 "$secret_tmp" "$SECRET_FILE"
  rm -f "$secret_tmp"
fi
: "${ADS_REPORT_FINGERPRINT_SECRET:?Missing ADS_REPORT_FINGERPRINT_SECRET}"

existing_walletconnect_project_id=''
existing_network=''
existing_base_rpc_url=''
if run_root test -r "$ACTIVE_ENV_FILE"; then
  existing_walletconnect_project_id="$(run_root sed -n 's/^NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=//p' "$ACTIVE_ENV_FILE")"
  existing_network="$(run_root sed -n 's/^PRECOMMUNITY_NETWORK=//p' "$ACTIVE_ENV_FILE")"
  existing_base_rpc_url="$(run_root sed -n 's/^BASE_RPC_URL=//p' "$ACTIVE_ENV_FILE")"
fi
walletconnect_project_id="${PRECOMMUNITY_WALLETCONNECT_PROJECT_ID:-$existing_walletconnect_project_id}"
if [[ -n "$walletconnect_project_id" && ! "$walletconnect_project_id" =~ ^[a-fA-F0-9]{32}$ ]]; then
  echo 'WalletConnect project ID must be a 32-character hexadecimal value.' >&2
  exit 2
fi

if [[ -n "$BASE_RPC_URL_OVERRIDE" ]]; then
  base_rpc_url="$BASE_RPC_URL_OVERRIDE"
elif [[ "$existing_network" == "$DEPLOYMENT_NETWORK" && -n "$existing_base_rpc_url" ]]; then
  base_rpc_url="$existing_base_rpc_url"
elif [[ "$DEPLOYMENT_NETWORK" == base ]]; then
  base_rpc_url='https://mainnet.base.org'
else
  base_rpc_url='https://sepolia.base.org'
fi

env_tmp="$(mktemp)"
trap 'rm -f "${secret_tmp:-}" "${env_tmp:-}"' EXIT
{
  printf '%s\n' \
    'NODE_ENV=production' \
    "PRECOMMUNITY_NETWORK=${DEPLOYMENT_NETWORK}" \
    "NEXT_PUBLIC_PRECOMMUNITY_NETWORK=${DEPLOYMENT_NETWORK}"
  render_runtime_deployment_env \
    "$DEPLOYMENT_NETWORK" \
    "$SAFE_ADDRESS" \
    "$ESCROW_ADDRESS" \
    "$ESCROW_DEPLOYMENT_BLOCK" \
    "$PRE_ADDRESS" \
    "$USDC_ADDRESS" \
    "$INITIAL_OWNER_ADDRESS" \
    "$TREASURY_ADDRESS" \
    "$CHAIN_CONFIRMATIONS" \
    "$base_rpc_url" \
    "$ADS_CONTRACT_ADDRESS_VALUE" \
    "$ADS_CONTRACT_DEPLOYMENT_BLOCK_VALUE"
  printf '%s\n' \
    "WEB_ORIGIN=https://${DOMAIN}" \
    'NEXT_PUBLIC_API_URL=/api' \
    'INTERNAL_API_URL=http://127.0.0.1:4000' \
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=${walletconnect_project_id}" \
    "COMMUNITY_MIN_PRE=${PRECOMMUNITY_MIN_PRE:-1}" \
    'IPFS_GATEWAY_URL=https://ipfs.io/ipfs/' \
    'IPFS_TIMEOUT_MS=5000' \
    "SIWE_DOMAIN=${DOMAIN}" \
    "SIWE_URI=https://${DOMAIN}" \
    "SESSION_SECRET=${SESSION_SECRET}" \
    "ADS_REPORT_FINGERPRINT_SECRET=${ADS_REPORT_FINGERPRINT_SECRET}"
} >"$env_tmp"
run_root install -o root -g "$APP_GROUP" -m 0640 "$env_tmp" "$ENV_FILE"
rm -f "$env_tmp"

printf 'Configured production runtime for %s in %s; secrets were not printed.\n' "$DOMAIN" "$ENV_FILE"
