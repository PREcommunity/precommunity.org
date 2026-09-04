#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/runtime-deployment-env.sh"

readonly SAFE_ADDRESS_VALUE=0x1111111111111111111111111111111111111111
readonly ESCROW_ADDRESS_VALUE=0x2222222222222222222222222222222222222222
readonly PRE_ADDRESS_VALUE=0x3333333333333333333333333333333333333333
readonly USDC_ADDRESS_VALUE=0x4444444444444444444444444444444444444444
readonly OWNER_ADDRESS_VALUE=0x5555555555555555555555555555555555555555
readonly TREASURY_ADDRESS_VALUE=0x6666666666666666666666666666666666666666
readonly ADS_ADDRESS_VALUE=0x7777777777777777777777777777777777777777

render_for_network() {
  render_runtime_deployment_env \
    "$1" \
    "$SAFE_ADDRESS_VALUE" \
    "$ESCROW_ADDRESS_VALUE" \
    12345 \
    "$PRE_ADDRESS_VALUE" \
    "$USDC_ADDRESS_VALUE" \
    "$OWNER_ADDRESS_VALUE" \
    "$TREASURY_ADDRESS_VALUE" \
    12 \
    https://rpc.example \
    "$ADS_ADDRESS_VALUE" \
    67890
}

mainnet_expected="$(cat <<EOF
SAFE_ADDRESS=${SAFE_ADDRESS_VALUE}
PUBLIC_ESCROW_ADDRESS=${ESCROW_ADDRESS_VALUE}
PUBLIC_ESCROW_DEPLOYMENT_BLOCK=12345
PUBLIC_PRE_ADDRESS=${PRE_ADDRESS_VALUE}
PUBLIC_USDC_ADDRESS=${USDC_ADDRESS_VALUE}
PUBLIC_INITIAL_OWNER_ADDRESS=${OWNER_ADDRESS_VALUE}
PUBLIC_TREASURY_ADDRESS=${TREASURY_ADDRESS_VALUE}
PUBLIC_CHAIN_CONFIRMATIONS=12
BASE_RPC_URL=https://rpc.example
NEXT_PUBLIC_BASE_RPC_URL=https://rpc.example
ADS_CONTRACT_ADDRESS=${ADS_ADDRESS_VALUE}
ADS_CONTRACT_DEPLOYMENT_BLOCK=67890
EOF
)"
testnet_expected="$(cat <<EOF
SAFE_ADDRESS_TESTNET=${SAFE_ADDRESS_VALUE}
ESCROW_ADDRESS_TESTNET=${ESCROW_ADDRESS_VALUE}
ESCROW_DEPLOYMENT_BLOCK_TESTNET=12345
PRE_ADDRESS_TESTNET=${PRE_ADDRESS_VALUE}
USDC_ADDRESS_TESTNET=${USDC_ADDRESS_VALUE}
INITIAL_OWNER_ADDRESS_TESTNET=${OWNER_ADDRESS_VALUE}
TREASURY_ADDRESS_TESTNET=${TREASURY_ADDRESS_VALUE}
CHAIN_CONFIRMATIONS_TESTNET=12
BASE_RPC_URL_TESTNET=https://rpc.example
NEXT_PUBLIC_BASE_RPC_URL_TESTNET=https://rpc.example
ADS_CONTRACT_ADDRESS_TESTNET=${ADS_ADDRESS_VALUE}
ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET=67890
EOF
)"

if [[ "$(render_for_network base)" != "$mainnet_expected" ]]; then
  echo 'Base runtime deployment environment does not match the expected variable names.' >&2
  exit 1
fi
if [[ "$(render_for_network base-sepolia)" != "$testnet_expected" ]]; then
  echo 'Base Sepolia runtime deployment environment does not match the expected variable names.' >&2
  exit 1
fi
if render_for_network unsupported >/dev/null 2>&1; then
  echo 'Unsupported deployment networks must be rejected.' >&2
  exit 1
fi

PUBLIC_ESCROW_ADDRESS=0x8888888888888888888888888888888888888888
PUBLIC_ESCROW_DEPLOYMENT_BLOCK=800
PUBLIC_PRE_ADDRESS=0x8888888888888888888888888888888888888881
PUBLIC_USDC_ADDRESS=0x8888888888888888888888888888888888888882
BASE_RPC_URL=https://base.example
ESCROW_ADDRESS_TESTNET=0x9999999999999999999999999999999999999999
ESCROW_DEPLOYMENT_BLOCK_TESTNET=900
PRE_ADDRESS_TESTNET=0x9999999999999999999999999999999999999991
USDC_ADDRESS_TESTNET=0x9999999999999999999999999999999999999992
BASE_RPC_URL_TESTNET=https://base-sepolia.example

if [[ "$(runtime_deployment_value base escrow_address)" != "$PUBLIC_ESCROW_ADDRESS" ||
  "$(runtime_deployment_value base escrow_deployment_block)" != "$PUBLIC_ESCROW_DEPLOYMENT_BLOCK" ||
  "$(runtime_deployment_value base pre_address)" != "$PUBLIC_PRE_ADDRESS" ||
  "$(runtime_deployment_value base usdc_address)" != "$PUBLIC_USDC_ADDRESS" ||
  "$(runtime_deployment_value base rpc_url)" != "$BASE_RPC_URL" ]]; then
  echo 'Base runtime values were not selected from the mainnet variables.' >&2
  exit 1
fi
if [[ "$(runtime_deployment_value base-sepolia escrow_address)" != "$ESCROW_ADDRESS_TESTNET" ||
  "$(runtime_deployment_value base-sepolia escrow_deployment_block)" != "$ESCROW_DEPLOYMENT_BLOCK_TESTNET" ||
  "$(runtime_deployment_value base-sepolia pre_address)" != "$PRE_ADDRESS_TESTNET" ||
  "$(runtime_deployment_value base-sepolia usdc_address)" != "$USDC_ADDRESS_TESTNET" ||
  "$(runtime_deployment_value base-sepolia rpc_url)" != "$BASE_RPC_URL_TESTNET" ]]; then
  echo 'Base Sepolia runtime values were not selected from the testnet variables.' >&2
  exit 1
fi
if runtime_deployment_value base unsupported >/dev/null 2>&1; then
  echo 'Unsupported runtime deployment fields must be rejected.' >&2
  exit 1
fi

printf 'Runtime deployment environment tests passed.\n'

validate_fixture() (
  ESCROW_ADDRESS="$ESCROW_ADDRESS_VALUE"
  PRE_ADDRESS="$PRE_ADDRESS_VALUE"
  USDC_ADDRESS="$USDC_ADDRESS_VALUE"
  INITIAL_OWNER_ADDRESS="$OWNER_ADDRESS_VALUE"
  TREASURY_ADDRESS="$TREASURY_ADDRESS_VALUE"
  ESCROW_DEPLOYMENT_BLOCK=123
  CHAIN_CONFIRMATIONS=''
  ADS_CONTRACT_ADDRESS_VALUE=''
  ADS_CONTRACT_DEPLOYMENT_BLOCK_VALUE=''
  if (( $# )); then printf -v "$1" '%s' "$2"; fi
  validate_runtime_deployment
)

validate_fixture
validate_fixture CHAIN_CONFIRMATIONS 1000
for fixture in 'ESCROW_ADDRESS invalid' 'ESCROW_ADDRESS 0x0000000000000000000000000000000000000000' 'ESCROW_DEPLOYMENT_BLOCK 0' 'CHAIN_CONFIRMATIONS 0' 'CHAIN_CONFIRMATIONS 1001' 'ADS_CONTRACT_ADDRESS_VALUE 0x1111111111111111111111111111111111111111' 'ADS_CONTRACT_DEPLOYMENT_BLOCK_VALUE 123'; do
  read -r field value <<<"$fixture"
  if validate_fixture "$field" "$value" >/dev/null 2>&1; then
    echo "Deployment validation accepted invalid $field." >&2
    exit 1
  else
    code="$?"
    [[ "$code" == 2 ]] || exit 1
  fi
done
printf 'Shared deployment validation tests passed.\n'
