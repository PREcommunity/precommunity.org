#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly TEST_ROOT="$(mktemp -d)"
readonly NODE_BINARY="$(command -v node)"
readonly BASH_BINARY="$(command -v bash)"
readonly CONFIG_DIR="$TEST_ROOT/config"
readonly STAGED_ENV="$CONFIG_DIR/app.env.next"
readonly MARKET=0x7777777777777777777777777777777777777777
readonly PRIVATE_RPC='https://private.example/rpc?key=private-fixture&network=base'
readonly PUBLIC_RPC='https://public.example/rpc?network=base&provider=browser'
cleanup() {
  local status=$?
  if (( status != 0 )) && [[ -r "$TEST_ROOT/output.log" ]]; then cat "$TEST_ROOT/output.log" >&2; fi
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT
mkdir -p "$TEST_ROOT/ops" "$TEST_ROOT/bin" "$TEST_ROOT/tmp" "$CONFIG_DIR"
cp "$SCRIPT_DIR/runtime-deployment-env.sh" "$TEST_ROOT/ops/"
"$NODE_BINARY" - "$SCRIPT_DIR/configure-app-runtime.sh" "$TEST_ROOT/ops/configure-app-runtime.sh" "$CONFIG_DIR" <<'NODE'
const fs = require('node:fs');
fs.writeFileSync(process.argv[3], fs.readFileSync(process.argv[2], 'utf8').replaceAll('/etc/precommunity', process.argv[4]));
NODE
cat >"$TEST_ROOT/bin/getent" <<'MOCK'
#!/usr/bin/env bash
[[ "$*" == 'passwd ubuntu' ]]
MOCK
cat >"$TEST_ROOT/bin/id" <<'MOCK'
#!/usr/bin/env bash
case "$1" in -u) printf '1000\n' ;; -gn|-un) printf 'ubuntu\n' ;; *) exit 90 ;; esac
MOCK
cat >"$TEST_ROOT/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
[[ "${1:-}" != -v ]] || exit 0
case "$1" in test|cat|sed|install) exec "$@" ;; *) echo 'Unexpected privileged command in runtime test' >&2; exit 90 ;; esac
MOCK
cat >"$TEST_ROOT/bin/install" <<'MOCK'
#!/usr/bin/env bash
args=()
while (( $# )); do
  case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac
done
for arg in "${args[@]}"; do
  if [[ "$arg" == /* && "$arg" != "$RUNTIME_TEST_ROOT"/* ]]; then echo 'Fixture attempted an outside write' >&2; exit 90; fi
done
exec /usr/bin/install "${args[@]}"
MOCK
chmod +x "$TEST_ROOT/bin/"*
ln -s "$BASH_BINARY" "$TEST_ROOT/bin/bash"
printf "SESSION_SECRET='%s'\nADS_REPORT_FINGERPRINT_SECRET='%s'\n" \
  '1111111111111111111111111111111111111111111111111111111111111111' \
  '2222222222222222222222222222222222222222222222222222222222222222' >"$CONFIG_DIR/app.secrets"

write_active() {
  local network="$1" backend="$2" browser="$3" suffix=''
  [[ "$network" != base-sepolia ]] || suffix=_TESTNET
  printf '%s\n' "PRECOMMUNITY_NETWORK=$network" \
    "BASE_RPC_URL${suffix}=\"${backend}\"" \
    "NEXT_PUBLIC_BASE_RPC_URL${suffix}=\"${browser}\"" \
    "ADS_CONTRACT_ADDRESS${suffix}=$MARKET" \
    "ADS_CONTRACT_DEPLOYMENT_BLOCK${suffix}=12345" \
    'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=11111111111111111111111111111111' >"$CONFIG_DIR/app.env"
}

run_configuration() {
  env -i PATH="$TEST_ROOT/bin:/usr/bin:/bin" TMPDIR="$TEST_ROOT/tmp" \
    RUNTIME_TEST_ROOT="$TEST_ROOT" \
    PRECOMMUNITY_ENV_FILE="$STAGED_ENV" \
    PRECOMMUNITY_NETWORK="$1" \
    PRECOMMUNITY_BASE_RPC_URL="${2:-}" \
    PRECOMMUNITY_BROWSER_RPC_URL="${3:-}" \
    ADS_CONTRACT_ADDRESS="${4:-}" \
    ADS_CONTRACT_DEPLOYMENT_BLOCK="${5:-}" \
    PRECOMMUNITY_SAFE_ADDRESS=0x3333333333333333333333333333333333333333 \
    PUBLIC_ESCROW_ADDRESS=0x1111111111111111111111111111111111111111 \
    PUBLIC_ESCROW_DEPLOYMENT_BLOCK=100 \
    PUBLIC_PRE_ADDRESS=0x2222222222222222222222222222222222222222 \
    PUBLIC_USDC_ADDRESS=0x4444444444444444444444444444444444444444 \
    PUBLIC_INITIAL_OWNER_ADDRESS=0x3333333333333333333333333333333333333333 \
    PUBLIC_TREASURY_ADDRESS=0x5555555555555555555555555555555555555555 \
    PUBLIC_CHAIN_CONFIRMATIONS=12 \
    bash "$TEST_ROOT/ops/configure-app-runtime.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1
}

read_value() (
  # Executing the generated shell-safe fixture checks quotation rather than merely its text.
  source "$STAGED_ENV"
  printf '%s' "${!1}"
)

assert_value() {
  if [[ "$(read_value "$1")" != "$2" ]]; then echo "Unexpected generated value for $1" >&2; exit 1; fi
}

write_active base "$PRIVATE_RPC" "$PUBLIC_RPC"
run_configuration base
assert_value ADS_CONTRACT_ADDRESS "$MARKET"
assert_value ADS_CONTRACT_DEPLOYMENT_BLOCK 12345
assert_value BASE_RPC_URL "$PRIVATE_RPC"
assert_value NEXT_PUBLIC_BASE_RPC_URL "$PUBLIC_RPC"

write_active base "$PRIVATE_RPC" "$PUBLIC_RPC"
run_configuration base-sepolia
assert_value ADS_CONTRACT_ADDRESS_TESTNET ''
assert_value ADS_CONTRACT_DEPLOYMENT_BLOCK_TESTNET ''
assert_value NEXT_PUBLIC_BASE_RPC_URL_TESTNET https://sepolia.base.org

write_active base "$PRIVATE_RPC" "$PRIVATE_RPC"
run_configuration base
assert_value BASE_RPC_URL "$PRIVATE_RPC"
assert_value NEXT_PUBLIC_BASE_RPC_URL https://mainnet.base.org

write_active base "$PRIVATE_RPC" ''
run_configuration base "$PRIVATE_RPC" "$PUBLIC_RPC"
assert_value BASE_RPC_URL "$PRIVATE_RPC"
assert_value NEXT_PUBLIC_BASE_RPC_URL "$PUBLIC_RPC"
if ! grep -Fq "NEXT_PUBLIC_BASE_RPC_URL=\"$PUBLIC_RPC\"" "$STAGED_ENV"; then
  echo 'A browser RPC query was not quoted for Bash and systemd.' >&2; exit 1
fi

cp "$STAGED_ENV" "$TEST_ROOT/staged-before"
if run_configuration base '' '' "$MARKET" ''; then
  echo 'A partial market deployment pair was accepted.' >&2; exit 1
fi
cmp -s "$STAGED_ENV" "$TEST_ROOT/staged-before" || { echo 'Invalid configuration modified staged output.' >&2; exit 1; }
if run_configuration base '' '' '' 12345; then
  echo 'A block-only market deployment pair was accepted.' >&2; exit 1
fi

printf 'Hermetic runtime configuration tests passed.\n'
