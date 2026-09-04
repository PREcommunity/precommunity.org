#!/usr/bin/env bash

render_runtime_deployment_env() {
  if (( $# != 12 )); then
    echo 'render_runtime_deployment_env requires 12 arguments.' >&2
    return 2
  fi

  local deployment_network="$1"
  local safe_address="$2"
  local escrow_address="$3"
  local escrow_deployment_block="$4"
  local pre_address="$5"
  local usdc_address="$6"
  local initial_owner_address="$7"
  local treasury_address="$8"
  local chain_confirmations="$9"
  local base_rpc_url="${10}"
  local ads_contract_address="${11}"
  local ads_contract_deployment_block="${12}"

  case "$deployment_network" in
    base)
      printf '%s\n' \
        "SAFE_ADDRESS=${safe_address}" \
        "PUBLIC_ESCROW_ADDRESS=${escrow_address}" \
        "PUBLIC_ESCROW_DEPLOYMENT_BLOCK=${escrow_deployment_block}" \
        "PUBLIC_PRE_ADDRESS=${pre_address}" \
        "PUBLIC_USDC_ADDRESS=${usdc_address}" \
        "PUBLIC_INITIAL_OWNER_ADDRESS=${initial_owner_address}" \
        "PUBLIC_TREASURY_ADDRESS=${treasury_address}" \
        "PUBLIC_CHAIN_CONFIRMATIONS=${chain_confirmations}" \
        "BASE_RPC_URL=${base_rpc_url}" \
        "NEXT_PUBLIC_BASE_RPC_URL=${base_rpc_url}" \
        "ADS_CONTRACT_ADDRESS=${ads_contract_address}" \
        "ADS_CONTRACT_DEPLOYMENT_BLOCK=${ads_contract_deployment_block}"
      ;;
    base-sepolia)
      printf '%s\n' \
        "SAFE_ADDRESS_TESTNET=${safe_address}" \
        "ESCROW_ADDRESS_TESTNET=${escrow_address}" \
        "ESCROW_DEPLOYMENT_BLOCK_TESTNET=${escrow_deployment_block}" \
        "PRE_ADDRESS_TESTNET=${pre_address}" \
        "USDC_ADDRESS_TESTNET=${usdc_address}" \
        "INITIAL_OWNER_ADDRESS_TESTNET=${initial_owner_address}" \
        "TREASURY_ADDRESS_TESTNET=${treasury_address}" \
        "CHAIN_CONFIRMATIONS_TESTNET=${chain_confirmations}" \
        "BASE_RPC_URL_TESTNET=${base_rpc_url}" \
        "NEXT_PUBLIC_BASE_RPC_URL_TESTNET=${base_rpc_url}" \
        "ADS_CONTRACT_ADDRESS_TESTNET=${ads_contract_address}" \
        "ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET=${ads_contract_deployment_block}"
      ;;
    *)
      printf 'Unsupported deployment network: %s\n' "$deployment_network" >&2
      return 2
      ;;
  esac
}

runtime_deployment_value() {
  if (( $# != 2 )); then
    echo 'runtime_deployment_value requires a network and field.' >&2
    return 2
  fi

  local deployment_network="$1"
  local field="$2"

  case "${deployment_network}:${field}" in
    base:safe_address) printf '%s' "${SAFE_ADDRESS:-}" ;;
    base:escrow_address) printf '%s' "${PUBLIC_ESCROW_ADDRESS:-}" ;;
    base:escrow_deployment_block) printf '%s' "${PUBLIC_ESCROW_DEPLOYMENT_BLOCK:-}" ;;
    base:pre_address) printf '%s' "${PUBLIC_PRE_ADDRESS:-}" ;;
    base:usdc_address) printf '%s' "${PUBLIC_USDC_ADDRESS:-}" ;;
    base:initial_owner_address) printf '%s' "${PUBLIC_INITIAL_OWNER_ADDRESS:-}" ;;
    base:treasury_address) printf '%s' "${PUBLIC_TREASURY_ADDRESS:-}" ;;
    base:chain_confirmations) printf '%s' "${PUBLIC_CHAIN_CONFIRMATIONS:-}" ;;
    base:rpc_url) printf '%s' "${BASE_RPC_URL:-}" ;;
    base:browser_rpc_url) printf '%s' "${NEXT_PUBLIC_BASE_RPC_URL:-}" ;;
    base:ads_contract_address) printf '%s' "${ADS_CONTRACT_ADDRESS:-}" ;;
    base:ads_contract_deployment_block) printf '%s' "${ADS_CONTRACT_DEPLOYMENT_BLOCK:-}" ;;
    base-sepolia:safe_address) printf '%s' "${SAFE_ADDRESS_TESTNET:-}" ;;
    base-sepolia:escrow_address) printf '%s' "${ESCROW_ADDRESS_TESTNET:-}" ;;
    base-sepolia:escrow_deployment_block) printf '%s' "${ESCROW_DEPLOYMENT_BLOCK_TESTNET:-}" ;;
    base-sepolia:pre_address) printf '%s' "${PRE_ADDRESS_TESTNET:-}" ;;
    base-sepolia:usdc_address) printf '%s' "${USDC_ADDRESS_TESTNET:-}" ;;
    base-sepolia:initial_owner_address) printf '%s' "${INITIAL_OWNER_ADDRESS_TESTNET:-}" ;;
    base-sepolia:treasury_address) printf '%s' "${TREASURY_ADDRESS_TESTNET:-}" ;;
    base-sepolia:chain_confirmations) printf '%s' "${CHAIN_CONFIRMATIONS_TESTNET:-}" ;;
    base-sepolia:rpc_url) printf '%s' "${BASE_RPC_URL_TESTNET:-}" ;;
    base-sepolia:browser_rpc_url) printf '%s' "${NEXT_PUBLIC_BASE_RPC_URL_TESTNET:-}" ;;
    base-sepolia:ads_contract_address) printf '%s' "${ADS_CONTRACT_ADDRESS_TESTNET:-}" ;;
    base-sepolia:ads_contract_deployment_block) printf '%s' "${ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET:-}" ;;
    *)
      printf 'Unsupported runtime deployment field: %s for %s\n' "$field" "$deployment_network" >&2
      return 2
      ;;
  esac
}

validate_runtime_deployment() {
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
}
