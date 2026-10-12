#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-vps.sh"
readonly TEST_ROOT="$(mktemp -d)"
readonly TEST_LOG="$TEST_ROOT/ssh.log"
trap 'rm -rf -- "$TEST_ROOT"' EXIT

mkdir -p "$TEST_ROOT/ops" "$TEST_ROOT/bin"
install -m 0755 "$DEPLOY_SCRIPT" "$TEST_ROOT/ops/deploy-vps.sh"
install -m 0644 "$SCRIPT_DIR/runtime-deployment-env.sh" "$TEST_ROOT/ops/runtime-deployment-env.sh"
install -m 0644 "$SCRIPT_DIR/operator-keystore-env.mjs" "$TEST_ROOT/ops/operator-keystore-env.mjs"

cat >"$TEST_ROOT/ops/write-release-manifest.mjs" <<'EOF'
import { writeFileSync } from 'node:fs';
writeFileSync(process.argv[2], '{"schema":"test-release"}');
EOF
cat >"$TEST_ROOT/.env" <<'EOF'
PRECOMMUNITY_NETWORK=base
PUBLIC_ESCROW_ADDRESS=0x1111111111111111111111111111111111111111
PUBLIC_ESCROW_DEPLOYMENT_BLOCK=12345
PUBLIC_PRE_ADDRESS=0x2222222222222222222222222222222222222222
PUBLIC_USDC_ADDRESS=0x3333333333333333333333333333333333333333
PUBLIC_INITIAL_OWNER_ADDRESS=0x4444444444444444444444444444444444444444
PUBLIC_TREASURY_ADDRESS=0x5555555555555555555555555555555555555555
SAFE_TRANSACTION_SERVICE_API_KEY=test-safe-api-key
COINGECKO_API_KEY=test-coingecko-api-key
EOF

cat >"$TEST_ROOT/remote-configuration" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "${PRECOMMUNITY_SAFE_TRANSACTION_SERVICE_API_KEY_STDIN:-0}" == 1 ]]; then
  IFS= read -r safe_api_key
  if [[ "$safe_api_key" != "$DEPLOY_TEST_SAFE_KEY" ]]; then
    echo 'Safe Transaction Service API key was not received over standard input.' >&2
    exit 1
  fi
  printf 'Safe Transaction Service settings received securely.\n' >>"$DEPLOY_TEST_LOG"
fi
if [[ "${PRECOMMUNITY_COINGECKO_API_KEY_STDIN:-0}" == 1 ]]; then
  IFS= read -r coingecko_api_key
  if [[ "$coingecko_api_key" != "$DEPLOY_TEST_COINGECKO_KEY" ]]; then
    echo 'CoinGecko Demo API key was not received over standard input.' >&2
    exit 1
  fi
  printf 'CoinGecko Demo settings received securely.\n' >>"$DEPLOY_TEST_LOG"
fi
if [[ "${PRECOMMUNITY_ADS_OPERATOR_KEYSTORE_STDIN:-0}" == 1 ]]; then
  IFS= read -r operator_payload
  if [[ "$operator_payload" != "$DEPLOY_TEST_OPERATOR_PAYLOAD" ]]; then
    echo 'The operator keystore pair was not received verbatim over standard input.' >&2
    exit 1
  fi
  printf 'Operator keystore settings received securely.\n' >>"$DEPLOY_TEST_LOG"
fi
if [[ "${PRECOMMUNITY_ADS_PRICE_UPDATER_KEYSTORE_STDIN:-0}" == 1 ]]; then
  IFS= read -r price_updater_payload
  if [[ "$price_updater_payload" != "$DEPLOY_TEST_UPDATER_PAYLOAD" ]]; then
    echo 'The updater keystore pair was not received verbatim over standard input.' >&2
    exit 1
  fi
  printf 'Price updater keystore settings received securely.\n' >>"$DEPLOY_TEST_LOG"
fi
if [[ "${DEPLOY_TEST_CHECK_RPC:-0}" == 1 ]]; then
  if [[ "${PRECOMMUNITY_BASE_RPC_URL:-}" != "$DEPLOY_TEST_BACKEND_RPC" ||
        "${PRECOMMUNITY_BROWSER_RPC_URL:-}" != "$DEPLOY_TEST_BROWSER_RPC" ]]; then
    echo 'SSH changed an RPC URL before runtime configuration.' >&2
    exit 1
  fi
  printf 'RPC URLs received verbatim.\n' >>"$DEPLOY_TEST_LOG"
fi
printf 'PUBLIC_ESCROW_ADDRESS=%s\n' "${PUBLIC_ESCROW_ADDRESS:-}" >>"$DEPLOY_TEST_LOG"
EOF
cat >"$TEST_ROOT/bin/ssh" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
shift
for argument in "$@"; do
  case "$argument" in *RPC_URL=*) printf '[RPC URL omitted] ' ;; *) printf '%s ' "$argument" ;; esac
done >>"$DEPLOY_TEST_LOG"
printf '\n' >>"$DEPLOY_TEST_LOG"
if [[ "$*" == *'/ops/configure-app-runtime.sh '* ]]; then
  # Match OpenSSH's remote command concatenation, replacing only the script runner.
  remote_command="$*"
  remote_command="${remote_command/ bash / $DEPLOY_TEST_REMOTE_CONFIGURATION }"
  env -i PATH=/usr/bin:/bin DEPLOY_TEST_LOG="$DEPLOY_TEST_LOG" \
    DEPLOY_TEST_SAFE_KEY="${DEPLOY_TEST_SAFE_KEY:-}" \
    DEPLOY_TEST_COINGECKO_KEY="${DEPLOY_TEST_COINGECKO_KEY:-}" \
    DEPLOY_TEST_OPERATOR_PAYLOAD="${DEPLOY_TEST_OPERATOR_PAYLOAD:-}" \
    DEPLOY_TEST_UPDATER_PAYLOAD="${DEPLOY_TEST_UPDATER_PAYLOAD:-}" \
    DEPLOY_TEST_CHECK_RPC="${DEPLOY_TEST_CHECK_RPC:-0}" \
    DEPLOY_TEST_BACKEND_RPC="${DEPLOY_TEST_BACKEND_RPC:-}" \
    DEPLOY_TEST_BROWSER_RPC="${DEPLOY_TEST_BROWSER_RPC:-}" \
    /bin/sh -c "$remote_command"
fi
EOF
cat >"$TEST_ROOT/bin/rsync" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TEST_ROOT/bin/ssh" "$TEST_ROOT/bin/rsync" "$TEST_ROOT/remote-configuration"
export DEPLOY_TEST_REMOTE_CONFIGURATION="$TEST_ROOT/remote-configuration"
export DEPLOY_TEST_COINGECKO_KEY=test-coingecko-api-key

PATH="$TEST_ROOT/bin:$PATH" \
  DEPLOY_TEST_LOG="$TEST_LOG" \
  DEPLOY_TEST_SAFE_KEY=test-safe-api-key \
  "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >/dev/null

if ! grep -Fq 'PUBLIC_ESCROW_ADDRESS=0x1111111111111111111111111111111111111111' "$TEST_LOG"; then
  echo 'deploy-vps.sh did not load PUBLIC_ESCROW_ADDRESS from the repository .env file.' >&2
  exit 1
fi
if ! grep -Fq 'Safe Transaction Service settings received securely.' "$TEST_LOG"; then
  echo 'deploy-vps.sh did not send the Safe Transaction Service settings.' >&2
  exit 1
fi
if ! grep -Fq 'CoinGecko Demo settings received securely.' "$TEST_LOG"; then
  echo 'deploy-vps.sh did not send the CoinGecko Demo settings.' >&2
  exit 1
fi
if grep -Eq 'test-safe-api-key|test-coingecko-api-key' "$TEST_LOG"; then
  echo 'deploy-vps.sh exposed an API key in SSH arguments.' >&2
  exit 1
fi

: >"$TEST_LOG"
PATH="$TEST_ROOT/bin:$PATH" \
  DEPLOY_TEST_LOG="$TEST_LOG" \
  DEPLOY_TEST_SAFE_KEY=override-safe-api-key \
  DEPLOY_TEST_COINGECKO_KEY=override-coingecko-api-key \
  PUBLIC_ESCROW_ADDRESS=0x6666666666666666666666666666666666666666 \
  SAFE_TRANSACTION_SERVICE_API_KEY=override-safe-api-key \
  COINGECKO_API_KEY=' override-coingecko-api-key ' \
  "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >/dev/null

if ! grep -Fq 'PUBLIC_ESCROW_ADDRESS=0x6666666666666666666666666666666666666666' "$TEST_LOG"; then
  echo 'An explicitly exported PUBLIC_ESCROW_ADDRESS did not override the repository .env file.' >&2
  exit 1
fi
if grep -Fq 'PUBLIC_ESCROW_ADDRESS=0x1111111111111111111111111111111111111111' "$TEST_LOG"; then
  echo 'The repository .env file unexpectedly overrode an explicitly exported address.' >&2
  exit 1
fi
if grep -Eq 'override-safe-api-key|override-coingecko-api-key' "$TEST_LOG"; then
  echo 'An explicitly exported API key was exposed in SSH arguments.' >&2
  exit 1
fi

printf 'VPS deployment environment loading tests passed.\n'

: >"$TEST_LOG"
PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" DEPLOY_TEST_SAFE_KEY=test-safe-api-key \
  DEPLOY_TEST_CHECK_RPC=1 DEPLOY_TEST_BACKEND_RPC='' DEPLOY_TEST_BROWSER_RPC=https://public-rpc.example \
  PRECOMMUNITY_KEYWORD_MARKET_RELEASE=1 \
  ADS_CONTRACT_ADDRESS=0x7777777777777777777777777777777777777777 \
  ADS_CONTRACT_DEPLOYMENT_BLOCK=456 \
  PRECOMMUNITY_BASE_RPC_URL='' \
  PRECOMMUNITY_BROWSER_RPC_URL=https://public-rpc.example \
  "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >/dev/null
for expected in 'PRECOMMUNITY_ENV_FILE=/etc/precommunity/app.env.next' 'PRECOMMUNITY_SKIP_DATABASE_DEPLOY=1' 'RPC URLs received verbatim.'; do
  if ! grep -Fq "$expected" "$TEST_LOG"; then echo "Prepared rollout omitted $expected" >&2; exit 1; fi
done
if grep -Fq 'ops/activate-release.sh' "$TEST_LOG" || grep -Fq 'ops/cutover-keyword-market.sh' "$TEST_LOG"; then
  echo 'Preparation must not activate or migrate the live application.' >&2
  exit 1
fi
printf 'Keyword Market staged deployment tests passed.\n'

readonly BACKEND_RPC="https://backend.example/rpc?key=backend-fixture'\"&network=base"
readonly BROWSER_RPC='https://public.example/rpc?network=base&provider=browser'
for safe_key in test-safe-api-key ''; do
  : >"$TEST_LOG"
  PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" DEPLOY_TEST_SAFE_KEY="$safe_key" \
    DEPLOY_TEST_CHECK_RPC=1 DEPLOY_TEST_BACKEND_RPC="$BACKEND_RPC" DEPLOY_TEST_BROWSER_RPC="$BROWSER_RPC" \
    PRECOMMUNITY_BASE_RPC_URL="$BACKEND_RPC" PRECOMMUNITY_BROWSER_RPC_URL="$BROWSER_RPC" \
    SAFE_TRANSACTION_SERVICE_API_KEY="$safe_key" \
    "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1
  grep -Fq 'RPC URLs received verbatim.' "$TEST_LOG"
  if grep -Fq 'backend-fixture' "$TEST_LOG" "$TEST_ROOT/output.log" ||
     grep -Eq 'test-safe-api-key|test-coingecko-api-key' "$TEST_LOG" "$TEST_ROOT/output.log"; then
    echo 'SSH exposed RPC credentials or an API key.' >&2
    exit 1
  fi
done
printf 'SSH remote-shell RPC quotation tests passed.\n'

for safe_key in test-safe-api-key ''; do
  for price_key in test-coingecko-api-key '' $' \t '; do
    : >"$TEST_LOG"
    PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" DEPLOY_TEST_SAFE_KEY="$safe_key" \
      SAFE_TRANSACTION_SERVICE_API_KEY="$safe_key" COINGECKO_API_KEY="$price_key" \
      "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1
    if [[ "$price_key" != test-coingecko-api-key ]] &&
       grep -Fq 'PRECOMMUNITY_COINGECKO_API_KEY_STDIN=1' "$TEST_LOG"; then
      echo 'An absent CoinGecko key should preserve the active server configuration.' >&2; exit 1
    fi
    if grep -Eq 'test-safe-api-key|test-coingecko-api-key' "$TEST_LOG" "$TEST_ROOT/output.log"; then
      echo 'API key combination test exposed a key.' >&2; exit 1
    fi
  done
done
for unsafe_price_key in 'unsafe fixture' 'unsafe"fixture' 'unsafe$fixture'; do
  : >"$TEST_LOG"
  if PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" \
    COINGECKO_API_KEY="$unsafe_price_key" \
    "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1; then
    echo 'An unsafe CoinGecko key was accepted by VPS deployment.' >&2; exit 1
  fi
  if [[ -s "$TEST_LOG" ]] || grep -Fq "$unsafe_price_key" "$TEST_ROOT/output.log"; then
    echo 'Rejected CoinGecko key reached SSH or was printed.' >&2; exit 1
  fi
done
printf 'Secure API key combinations and validation tests passed.\n'

readonly OPERATOR_PASSWORD=$' leading $ ` " \' \\ / # żółć trailing '
readonly OPERATOR_PASSWORD_BASE64="$(printf '%s' "$OPERATOR_PASSWORD" | base64 | tr -d '\n')"
readonly OPERATOR_PAYLOAD="$(printf '{"network":"base","path":"/srv/operator fixture.json","passwordBase64":"%s"}' "$OPERATOR_PASSWORD_BASE64")"
: >"$TEST_LOG"
PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" DEPLOY_TEST_SAFE_KEY=test-safe-api-key \
  DEPLOY_TEST_OPERATOR_PAYLOAD="$OPERATOR_PAYLOAD" \
  ADS_OPERATOR_KEYSTORE_PATH='/srv/operator fixture.json' \
  ADS_OPERATOR_KEYSTORE_PASSWORD="$OPERATOR_PASSWORD" \
  "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1
grep -Fq 'Operator keystore settings received securely.' "$TEST_LOG"
if grep -Fq "$OPERATOR_PASSWORD_BASE64" "$TEST_LOG" "$TEST_ROOT/output.log" || \
   grep -Fq 'operator fixture.json' "$TEST_LOG" "$TEST_ROOT/output.log"; then
  echo 'SSH exposed operator keystore credentials in arguments or output.' >&2; exit 1
fi
printf '%s\n' "ADS_OPERATOR_KEYSTORE_PATH='/srv/operator fixture.json'" >>"$TEST_ROOT/.env"
printf 'ADS_OPERATOR_KEYSTORE_PASSWORD=%q\n' "$OPERATOR_PASSWORD" >>"$TEST_ROOT/.env"
: >"$TEST_LOG"
PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" DEPLOY_TEST_SAFE_KEY=test-safe-api-key \
  DEPLOY_TEST_OPERATOR_PAYLOAD="$OPERATOR_PAYLOAD" \
  "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1
grep -Fq 'Operator keystore settings received securely.' "$TEST_LOG"
: >"$TEST_LOG"
PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" DEPLOY_TEST_SAFE_KEY=test-safe-api-key \
  PRECOMMUNITY_NETWORK=base-sepolia \
  ADS_OPERATOR_KEYSTORE_PATH='/srv/mainnet/operator.json' \
  ADS_OPERATOR_KEYSTORE_PASSWORD="$OPERATOR_PASSWORD" \
  "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1
if grep -Fq 'PRECOMMUNITY_ADS_OPERATOR_KEYSTORE_STDIN=1' "$TEST_LOG"; then
  echo 'A mainnet operator pair fell back to testnet.' >&2; exit 1
fi
: >"$TEST_LOG"
if PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" \
  ADS_OPERATOR_KEYSTORE_PATH='/srv/operator incomplete.json' ADS_OPERATOR_KEYSTORE_PASSWORD='' \
  "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1; then
  echo 'An incomplete operator pair was accepted.' >&2; exit 1
fi
if [[ -s "$TEST_LOG" ]] || grep -Fq 'operator incomplete.json' "$TEST_ROOT/output.log"; then
  echo 'Invalid operator configuration reached SSH or leaked its input.' >&2; exit 1
fi
printf 'Secure operator pair transfer and network isolation tests passed.\n'

readonly UPDATER_PASSWORD=$' private price $ ` " \' \\ / # żółć\ntrailing '
readonly UPDATER_PASSWORD_BASE64="$(printf '%s' "$UPDATER_PASSWORD" | base64 | tr -d '\n')"
readonly UPDATER_PAYLOAD="$(printf '{"network":"base","path":"/srv/price updater fixture.json","passwordBase64":"%s"}' "$UPDATER_PASSWORD_BASE64")"
for safe_key in test-safe-api-key ''; do
  for price_key in test-coingecko-api-key ''; do
    : >"$TEST_LOG"
    PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" DEPLOY_TEST_SAFE_KEY="$safe_key" \
      DEPLOY_TEST_OPERATOR_PAYLOAD="$OPERATOR_PAYLOAD" DEPLOY_TEST_UPDATER_PAYLOAD="$UPDATER_PAYLOAD" \
      SAFE_TRANSACTION_SERVICE_API_KEY="$safe_key" COINGECKO_API_KEY="$price_key" \
      ADS_PRICE_UPDATER_KEYSTORE_PATH='/srv/price updater fixture.json' ADS_PRICE_UPDATER_KEYSTORE_PASSWORD="$UPDATER_PASSWORD" \
      "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1
    grep -Fq 'Price updater keystore settings received securely.' "$TEST_LOG"
    grep -Fq 'Operator keystore settings received securely.' "$TEST_LOG"
    if grep -Fq "$UPDATER_PASSWORD_BASE64" "$TEST_LOG" "$TEST_ROOT/output.log" || \
       grep -Fq 'price updater fixture.json' "$TEST_LOG" "$TEST_ROOT/output.log"; then
      echo 'SSH exposed price updater credentials in arguments or output.' >&2; exit 1
    fi
  done
done
printf '%s\n' "ADS_PRICE_UPDATER_KEYSTORE_PATH='/srv/price updater fixture.json'" \
  "ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64='$UPDATER_PASSWORD_BASE64'" >>"$TEST_ROOT/.env"
: >"$TEST_LOG"
PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" DEPLOY_TEST_SAFE_KEY=test-safe-api-key \
  DEPLOY_TEST_OPERATOR_PAYLOAD="$OPERATOR_PAYLOAD" DEPLOY_TEST_UPDATER_PAYLOAD="$UPDATER_PAYLOAD" \
  "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1
grep -Fq 'Price updater keystore settings received securely.' "$TEST_LOG"
: >"$TEST_LOG"
PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" DEPLOY_TEST_SAFE_KEY=test-safe-api-key \
  PRECOMMUNITY_NETWORK=base-sepolia \
  "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1
if grep -Fq 'PRECOMMUNITY_ADS_PRICE_UPDATER_KEYSTORE_STDIN=1' "$TEST_LOG"; then
  echo 'A mainnet updater pair fell back to testnet.' >&2; exit 1
fi
for updater_password in '' 'invalid private price fixture'; do
  : >"$TEST_LOG"
  if PATH="$TEST_ROOT/bin:$PATH" DEPLOY_TEST_LOG="$TEST_LOG" \
    ADS_PRICE_UPDATER_KEYSTORE_PATH='/private price fixture.json' ADS_PRICE_UPDATER_KEYSTORE_PASSWORD='' \
    ADS_PRICE_UPDATER_KEYSTORE_PASSWORD_BASE64="$updater_password" \
    "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >"$TEST_ROOT/output.log" 2>&1; then
    echo 'An incomplete or invalid updater pair was accepted.' >&2; exit 1
  fi
  if [[ -s "$TEST_LOG" ]] || grep -Fq 'private price fixture' "$TEST_ROOT/output.log"; then
    echo 'Invalid updater configuration reached SSH or leaked its input.' >&2; exit 1
  fi
done
printf 'Secure updater transfer, combined stdin ordering and network isolation tests passed.\n'
