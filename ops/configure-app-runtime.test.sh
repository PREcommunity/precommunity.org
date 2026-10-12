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
cp "$SCRIPT_DIR/operator-keystore-env.mjs" "$TEST_ROOT/ops/"
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
ln -s "$NODE_BINARY" "$TEST_ROOT/bin/node"
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
    'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=11111111111111111111111111111111' \
    "COINGECKO_API_KEY=\"${4:-}\"" \
    "SAFE_TRANSACTION_SERVICE_API_KEY=${5:-}" >"$CONFIG_DIR/app.env"
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
    PRECOMMUNITY_SAFE_TRANSACTION_SERVICE_API_KEY_STDIN="${6:-0}" \
    PRECOMMUNITY_COINGECKO_API_KEY_STDIN="${7:-0}" \
    PRECOMMUNITY_ADS_OPERATOR_KEYSTORE_STDIN="${8:-0}" \
    PRECOMMUNITY_ADS_PRICE_UPDATER_KEYSTORE_STDIN="${9:-0}" \
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

write_active base "$PRIVATE_RPC" "$PUBLIC_RPC" ' existing-price-fixture '
run_configuration base-sepolia
assert_value COINGECKO_API_KEY existing-price-fixture
if grep -Eq '^NEXT_PUBLIC_COINGECKO' "$STAGED_ENV"; then
  echo 'CoinGecko key was exposed to the browser.' >&2; exit 1
fi
if grep -Fq 'existing-price-fixture' "$TEST_ROOT/output.log"; then
  echo 'Runtime configuration printed the CoinGecko key.' >&2; exit 1
fi

write_active base "$PRIVATE_RPC" "$PUBLIC_RPC" existing-price-fixture existing-safe-fixture
printf 'safe-input-fixture\n price-input-fixture \n' | run_configuration base '' '' '' '' 1 1
assert_value SAFE_TRANSACTION_SERVICE_API_KEY safe-input-fixture
assert_value COINGECKO_API_KEY price-input-fixture
if grep -Eq 'safe-input-fixture|price-input-fixture' "$TEST_ROOT/output.log"; then
  echo 'Runtime configuration printed a provisioned API key.' >&2; exit 1
fi

printf ' \t \n' | run_configuration base '' '' '' '' 0 1
assert_value COINGECKO_API_KEY existing-price-fixture
assert_value SAFE_TRANSACTION_SERVICE_API_KEY existing-safe-fixture
write_active base "$PRIVATE_RPC" "$PUBLIC_RPC" '   '
run_configuration base
assert_value COINGECKO_API_KEY ''

cp "$STAGED_ENV" "$TEST_ROOT/staged-before"
if printf 'unsafe"fixture\n' | run_configuration base '' '' '' '' 0 1; then
  echo 'An unsafe CoinGecko key was accepted.' >&2; exit 1
fi
cmp -s "$STAGED_ENV" "$TEST_ROOT/staged-before" || { echo 'An unsafe key modified staged output.' >&2; exit 1; }
if grep -Fq 'unsafe"fixture' "$TEST_ROOT/output.log"; then
  echo 'Runtime configuration printed a rejected API key.' >&2; exit 1
fi
if run_configuration base '' '' '' '' 0 1 </dev/null; then
  echo 'CoinGecko key provisioning accepted missing input.' >&2; exit 1
fi
if printf 'safe-only-fixture\n' | run_configuration base '' '' '' '' 1 1; then
  echo 'Combined API key provisioning accepted a missing second line.' >&2; exit 1
fi
if run_configuration base '' '' '' '' 0 2; then
  echo 'An invalid CoinGecko stdin flag was accepted.' >&2; exit 1
fi
write_active base "$PRIVATE_RPC" "$PUBLIC_RPC" 'unsafe fixture'
if run_configuration base; then
  echo 'An unsafe existing CoinGecko key was accepted.' >&2; exit 1
fi
cmp -s "$STAGED_ENV" "$TEST_ROOT/staged-before" || { echo 'Invalid key configuration modified staged output.' >&2; exit 1; }

readonly OPERATOR_PASSWORD=$' leading $ ` " \' \\ / # żółć trailing '
readonly OPERATOR_PASSWORD_BASE64="$(printf '%s' "$OPERATOR_PASSWORD" | base64 | tr -d '\n')"
write_active base "$PRIVATE_RPC" "$PUBLIC_RPC"
printf '%s\n' \
  "ADS_OPERATOR_KEYSTORE_PATH='/srv/mainnet/operator fixture.json'" \
  "ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64='$OPERATOR_PASSWORD_BASE64'" \
  "ADS_OPERATOR_KEYSTORE_PATH_TESTNET='/srv/testnet/operator.json'" \
  "ADS_OPERATOR_KEYSTORE_PASSWORD_TESTNET=' old testnet password '" >>"$CONFIG_DIR/app.env"
run_configuration base-sepolia
assert_value ADS_OPERATOR_KEYSTORE_PATH '/srv/mainnet/operator fixture.json'
assert_value ADS_OPERATOR_KEYSTORE_PASSWORD ''
assert_value ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64 "$OPERATOR_PASSWORD_BASE64"
assert_value ADS_OPERATOR_KEYSTORE_PATH_TESTNET '/srv/testnet/operator.json'
assert_value ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64_TESTNET "$(printf '%s' ' old testnet password ' | base64 | tr -d '\n')"
"$NODE_BINARY" - "$STAGED_ENV" <<'NODE'
const {parseEnv}=require('node:util');
const fs=require('node:fs');
const values=parseEnv(fs.readFileSync(process.argv[2], 'utf8'));
if (Buffer.from(values.ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64,'base64').toString() !== ' leading $ ` " \' \\ / # żółć trailing ') {
  throw new Error('The generated operator password changed.');
}
NODE
printf '{"network":"base-sepolia","path":"/srv/testnet/operator next.json","passwordBase64":"%s"}\n' \
  "$OPERATOR_PASSWORD_BASE64" | run_configuration base-sepolia '' '' '' '' 0 0 1
assert_value ADS_OPERATOR_KEYSTORE_PATH '/srv/mainnet/operator fixture.json'
assert_value ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64 "$OPERATOR_PASSWORD_BASE64"
assert_value ADS_OPERATOR_KEYSTORE_PATH_TESTNET '/srv/testnet/operator next.json'
assert_value ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64_TESTNET "$OPERATOR_PASSWORD_BASE64"
if grep -Fq "$OPERATOR_PASSWORD_BASE64" "$TEST_ROOT/output.log"; then
  echo 'Runtime configuration printed the operator password.' >&2; exit 1
fi
cp "$STAGED_ENV" "$TEST_ROOT/staged-before"
if run_configuration base '' '' '' '' 0 0 1 </dev/null; then
  echo 'Operator provisioning accepted missing input.' >&2; exit 1
fi
cmp -s "$STAGED_ENV" "$TEST_ROOT/staged-before" || { echo 'Invalid operator input modified staged output.' >&2; exit 1; }

readonly UPDATER_PASSWORD=$' leading price $ ` " \' \\ / # żółć\ntrailing '
readonly UPDATER_PASSWORD_BASE64="$(printf '%s' "$UPDATER_PASSWORD" | base64 | tr -d '\n')"
write_active base "$PRIVATE_RPC" "$PUBLIC_RPC"
printf '%s\n' \
  "ADS_PRICE_UPDATER_KEYSTORE_PATH='/srv/mainnet/price fixture.json'" \
  "ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64='$UPDATER_PASSWORD_BASE64'" \
  "ADS_PRICE_UPDATER_KEYSTORE_PATH_TESTNET='/srv/testnet/price.json'" \
  "ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_TESTNET=' previous testnet price fixture '" \
  "ADS_OPERATOR_KEYSTORE_PATH='/srv/mainnet/operator fixture.json'" \
  "ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64='$OPERATOR_PASSWORD_BASE64'" >>"$CONFIG_DIR/app.env"
run_configuration base-sepolia
assert_value ADS_PRICE_UPDATER_KEYSTORE_PATH '/srv/mainnet/price fixture.json'
assert_value ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64 "$UPDATER_PASSWORD_BASE64"
assert_value ADS_PRICE_UPDATER_KEYSTORE_PATH_TESTNET '/srv/testnet/price.json'
assert_value ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64_TESTNET "$(printf '%s' ' previous testnet price fixture ' | base64 | tr -d '\n')"
assert_value ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64 "$OPERATOR_PASSWORD_BASE64"
printf '{"network":"base-sepolia","path":"/srv/testnet/price next.json","passwordBase64":"%s"}\n' \
  "$UPDATER_PASSWORD_BASE64" | run_configuration base-sepolia '' '' '' '' 0 0 0 1
assert_value ADS_PRICE_UPDATER_KEYSTORE_PATH_TESTNET '/srv/testnet/price next.json'
assert_value ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64_TESTNET "$UPDATER_PASSWORD_BASE64"
assert_value ADS_PRICE_UPDATER_KEYSTORE_PATH '/srv/mainnet/price fixture.json'
assert_value ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64 "$OPERATOR_PASSWORD_BASE64"
if grep -Fq "$UPDATER_PASSWORD_BASE64" "$TEST_ROOT/output.log"; then
  echo 'Runtime configuration printed the price updater password.' >&2; exit 1
fi
printf '{"network":"base-sepolia","path":"/srv/testnet/operator together.json","passwordBase64":"%s"}\n{"network":"base-sepolia","path":"/srv/testnet/price together.json","passwordBase64":"%s"}\n' \
  "$OPERATOR_PASSWORD_BASE64" "$UPDATER_PASSWORD_BASE64" | run_configuration base-sepolia '' '' '' '' 0 0 1 1
assert_value ADS_OPERATOR_KEYSTORE_PATH_TESTNET '/srv/testnet/operator together.json'
assert_value ADS_OPERATOR_KEYSTORE_PASSWORD_BASE64_TESTNET "$OPERATOR_PASSWORD_BASE64"
assert_value ADS_PRICE_UPDATER_KEYSTORE_PATH_TESTNET '/srv/testnet/price together.json'
assert_value ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64_TESTNET "$UPDATER_PASSWORD_BASE64"
cp "$STAGED_ENV" "$TEST_ROOT/staged-before"
if run_configuration base-sepolia '' '' '' '' 0 0 0 1 </dev/null; then
  echo 'Updater provisioning accepted missing input.' >&2; exit 1
fi
if run_configuration base-sepolia '' '' '' '' 0 0 0 2; then
  echo 'An invalid updater stdin flag was accepted.' >&2; exit 1
fi
if printf '{"network":"base","path":"/private price fixture.json","passwordBase64":"%s"}\n' \
  "$UPDATER_PASSWORD_BASE64" | run_configuration base-sepolia '' '' '' '' 0 0 0 1; then
  echo 'Updater provisioning accepted a different network.' >&2; exit 1
fi
if grep -Eq 'private price fixture|price next.json' "$TEST_ROOT/output.log" || grep -Fq "$UPDATER_PASSWORD_BASE64" "$TEST_ROOT/output.log"; then
  echo 'Invalid updater input leaked its credentials.' >&2; exit 1
fi
if printf '{"network":"base-sepolia","path":"/private price fixture.json","passwordBase64":"invalid private price fixture"}\n' | run_configuration base-sepolia '' '' '' '' 0 0 0 1; then
  echo 'Updater provisioning accepted malformed password encoding.' >&2; exit 1
fi
cmp -s "$STAGED_ENV" "$TEST_ROOT/staged-before" || { echo 'Invalid updater input modified staged output.' >&2; exit 1; }
printf 'Hermetic runtime configuration tests passed.\n'
