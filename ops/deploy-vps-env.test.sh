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

cat >"$TEST_ROOT/.env" <<'EOF'
PRECOMMUNITY_NETWORK=base
PUBLIC_ESCROW_ADDRESS=0x1111111111111111111111111111111111111111
PUBLIC_ESCROW_DEPLOYMENT_BLOCK=12345
PUBLIC_PRE_ADDRESS=0x2222222222222222222222222222222222222222
PUBLIC_USDC_ADDRESS=0x3333333333333333333333333333333333333333
PUBLIC_INITIAL_OWNER_ADDRESS=0x4444444444444444444444444444444444444444
PUBLIC_TREASURY_ADDRESS=0x5555555555555555555555555555555555555555
SAFE_TRANSACTION_SERVICE_API_KEY=test-safe-api-key
EOF

cat >"$TEST_ROOT/bin/ssh" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == *'PRECOMMUNITY_SAFE_TRANSACTION_SERVICE_API_KEY_STDIN=1'* ]]; then
  IFS= read -r safe_api_key
  if [[ "$safe_api_key" != "$DEPLOY_TEST_SAFE_KEY" ]]; then
    echo 'Safe Transaction Service API key was not received over standard input.' >&2
    exit 1
  fi
  printf 'Safe Transaction Service settings received securely.\n' >>"$DEPLOY_TEST_LOG"
fi
printf '%s\n' "$*" >>"$DEPLOY_TEST_LOG"
EOF
cat >"$TEST_ROOT/bin/rsync" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$TEST_ROOT/bin/ssh" "$TEST_ROOT/bin/rsync"

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
if grep -Fq 'test-safe-api-key' "$TEST_LOG"; then
  echo 'deploy-vps.sh exposed the Safe Transaction Service API key in SSH arguments.' >&2
  exit 1
fi

: >"$TEST_LOG"
PATH="$TEST_ROOT/bin:$PATH" \
  DEPLOY_TEST_LOG="$TEST_LOG" \
  DEPLOY_TEST_SAFE_KEY=override-safe-api-key \
  PUBLIC_ESCROW_ADDRESS=0x6666666666666666666666666666666666666666 \
  SAFE_TRANSACTION_SERVICE_API_KEY=override-safe-api-key \
  "$TEST_ROOT/ops/deploy-vps.sh" precommunity.org >/dev/null

if ! grep -Fq 'PUBLIC_ESCROW_ADDRESS=0x6666666666666666666666666666666666666666' "$TEST_LOG"; then
  echo 'An explicitly exported PUBLIC_ESCROW_ADDRESS did not override the repository .env file.' >&2
  exit 1
fi
if grep -Fq 'PUBLIC_ESCROW_ADDRESS=0x1111111111111111111111111111111111111111' "$TEST_LOG"; then
  echo 'The repository .env file unexpectedly overrode an explicitly exported address.' >&2
  exit 1
fi
if grep -Fq 'override-safe-api-key' "$TEST_LOG"; then
  echo 'An explicitly exported Safe API key was exposed in SSH arguments.' >&2
  exit 1
fi

printf 'VPS deployment environment loading tests passed.\n'
