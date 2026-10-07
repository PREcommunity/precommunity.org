#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly TEST_ROOT="$(mktemp -d)"
readonly NODE_BINARY="$(command -v node)"
readonly BASH_BINARY="$(command -v bash)"
cleanup() {
  local status=$?
  if (( status != 0 )) && [[ -r "${CASE_ROOT:-}/output.log" ]]; then cat "$CASE_ROOT/output.log" >&2; fi
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT
mkdir -p "$TEST_ROOT/bin"
cat >"$TEST_ROOT/bin/sudo" <<'MOCK'
#!/usr/bin/env bash
printf 'SUDO %s\n' "$*" >>"$CUTOVER_TEST_LOG"
if [[ "${1:-}" == -u ]]; then shift 2; fi
case "$1" in install|cp|tee|pg_dump|pg_restore|sha256sum|psql|createdb|dropdb|systemctl) exec "$@" ;; *) echo 'Unexpected privileged fixture command' >&2; exit 90 ;; esac
MOCK
cat >"$TEST_ROOT/bin/install" <<'MOCK'
#!/usr/bin/env bash
args=()
while (( $# )); do case "$1" in -o|-g) shift 2 ;; *) args+=("$1"); shift ;; esac; done
for arg in "${args[@]}"; do
  if [[ "$arg" == /* && "$arg" != "$CUTOVER_TEST_CASE"/* ]]; then echo 'Fixture attempted an outside write' >&2; exit 90; fi
done
exec /usr/bin/install "${args[@]}"
MOCK
cat >"$TEST_ROOT/bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
printf 'SYSTEMCTL %s\n' "$*" >>"$CUTOVER_TEST_LOG"
if [[ "$1" == show ]]; then
  case "$*" in
    *ActiveState*) if [[ "$2" == precommunity-worker.service ]]; then printf '%s\n' "${CUTOVER_TEST_ACTIVE_STATE:-inactive}"; else printf 'inactive\n'; fi ;;
    *MainPID*) if [[ "$2" == precommunity-worker.service ]]; then printf '%s\n' "${CUTOVER_TEST_WORKER_PID:-0}"; else printf '0\n'; fi ;;
    *) exit 90 ;;
  esac
fi
MOCK
cat >"$TEST_ROOT/bin/id" <<'MOCK'
#!/usr/bin/env bash
case "$1" in -un|-gn) printf 'ubuntu\n' ;; *) exit 90 ;; esac
MOCK
cat >"$TEST_ROOT/bin/readlink" <<'MOCK'
#!/usr/bin/env bash
printf '%s/srv/precommunity/releases/old\n' "$CUTOVER_TEST_CASE"
MOCK
cat >"$TEST_ROOT/bin/pg_dump" <<'MOCK'
#!/usr/bin/env bash
printf 'PG_DUMP %s\n' "$*" >>"$CUTOVER_TEST_LOG"
for arg in "$@"; do if [[ "$arg" == --file=* ]]; then destination="${arg#--file=}"; fi; done
[[ "${destination:-}" == "$CUTOVER_TEST_CASE"/* ]] || exit 90
printf 'hermetic backup fixture\n' >"$destination"
MOCK
cat >"$TEST_ROOT/bin/pg_restore" <<'MOCK'
#!/usr/bin/env bash
printf 'PG_RESTORE %s\n' "$*" >>"$CUTOVER_TEST_LOG"
[[ -r "${!#}" ]] || exit 90
if [[ "$*" != *--list* && "${CUTOVER_TEST_FAIL_RESTORE:-0}" == 1 ]]; then exit 7; fi
MOCK
cat >"$TEST_ROOT/bin/psql" <<'MOCK'
#!/usr/bin/env bash
printf 'PSQL %s\n' "$*" >>"$CUTOVER_TEST_LOG"
if [[ "$*" == *json_build_array* ]]; then printf '[2,1,1,0,3,5]\n'; fi
MOCK
cat >"$TEST_ROOT/bin/pnpm" <<'MOCK'
#!/usr/bin/env bash
printf 'PNPM %s\n' "$*" >>"$CUTOVER_TEST_LOG"
if [[ "$*" == db:deploy && "${CUTOVER_TEST_FAIL_MIGRATION:-0}" == 1 ]]; then exit 8; fi
MOCK
cat >"$TEST_ROOT/bin/sha256sum" <<'MOCK'
#!/usr/bin/env bash
printf '%064d  %s\n' 1 "$1"
MOCK
for command in corepack flock createdb dropdb curl sleep; do
  cat >"$TEST_ROOT/bin/$command" <<'MOCK'
#!/usr/bin/env bash
printf '%s %s\n' "${0##*/}" "$*" >>"$CUTOVER_TEST_LOG"
MOCK
done
cat >"$TEST_ROOT/bin/node-runtime" <<'MOCK'
#!/usr/bin/env bash
printf 'NODE %s\n' "$*" >>"$CUTOVER_TEST_LOG"
case "${1:-}" in
  apps/worker/dist/backfill.js) [[ "$*" == "apps/worker/dist/backfill.js --phase ${CUTOVER_TEST_EXPECT_PHASE:-active}" ]] || exit 90 ;;
  apps/worker/dist/check-keyword-market.js)
    [[ "$*" == "apps/worker/dist/check-keyword-market.js --phase ${CUTOVER_TEST_EXPECT_PHASE:-active}" ]] || exit 90
    printf '{"status":"READY","phase":"%s","paused":%s,"abiSha256":"%s","artifactSha256":"artifact-fixture","buildInfoId":"build-fixture"}\n' "${CUTOVER_TEST_RETURN_PHASE:-${CUTOVER_TEST_EXPECT_PHASE:-active}}" "${CUTOVER_TEST_PAUSED:-false}" "${CUTOVER_TEST_ABI:-abi-fixture}" ;;
  --input-type=module) exec "$CUTOVER_TEST_REAL_NODE" "$@" ;;
  *) echo 'Unexpected Node fixture entry point' >&2; exit 90 ;;
esac
MOCK
chmod +x "$TEST_ROOT/bin/"*
ln -s "$BASH_BINARY" "$TEST_ROOT/bin/bash"

prepare_case() {
  CASE_ROOT="$TEST_ROOT/$1"
  RELEASE_DIR="$CASE_ROOT/srv/precommunity/releases/new"
  LOG="$CASE_ROOT/commands.log"
  mkdir -p "$RELEASE_DIR/ops" "$RELEASE_DIR/apps/worker/dist" "$CASE_ROOT/etc/precommunity" \
    "$CASE_ROOT/home/ubuntu/.nvm" "$CASE_ROOT/home/ubuntu/.local/bin" "$CASE_ROOT/tmp"
  : >"$LOG"
  cp "$SCRIPT_DIR/runtime-deployment-env.sh" "$RELEASE_DIR/ops/"
  "$NODE_BINARY" - "$SCRIPT_DIR/cutover-keyword-market.sh" "$RELEASE_DIR/ops/cutover-keyword-market.sh" "$CASE_ROOT" <<'NODE'
const fs = require('node:fs');
let script = fs.readFileSync(process.argv[2], 'utf8');
for (const root of ['/srv/precommunity', '/etc/precommunity', '/home/ubuntu', '/var/backups/precommunity']) {
  script = script.replaceAll(root, `${process.argv[4]}${root}`);
}
fs.writeFileSync(process.argv[3], script);
NODE
  cp "$TEST_ROOT/bin/node-runtime" "$CASE_ROOT/home/ubuntu/.local/bin/precommunity-node"
  printf 'nvm() { printf "NVM %%s\\n" "$*" >>"$CUTOVER_TEST_LOG"; }\n' >"$CASE_ROOT/home/ubuntu/.nvm/nvm.sh"
  printf '%s\n' 'DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:5432/precommunity' >"$CASE_ROOT/etc/precommunity/data-services.env"
  cat >"$CASE_ROOT/common.env" <<'ENV'
PRECOMMUNITY_NETWORK=base
WEB_ORIGIN=https://precommunity.org
SAFE_ADDRESS=0x3333333333333333333333333333333333333333
PUBLIC_ESCROW_ADDRESS=0x1111111111111111111111111111111111111111
PUBLIC_ESCROW_DEPLOYMENT_BLOCK=100
PUBLIC_PRE_ADDRESS=0x2222222222222222222222222222222222222222
PUBLIC_USDC_ADDRESS=0x4444444444444444444444444444444444444444
PUBLIC_INITIAL_OWNER_ADDRESS=0x3333333333333333333333333333333333333333
PUBLIC_TREASURY_ADDRESS=0x5555555555555555555555555555555555555555
PUBLIC_CHAIN_CONFIRMATIONS=12
ENV
  cp "$CASE_ROOT/common.env" "$CASE_ROOT/etc/precommunity/app.env"
  printf 'ADS_CONTRACT_ADDRESS=\nADS_CONTRACT_DEPLOYMENT_BLOCK=\n' >>"$CASE_ROOT/etc/precommunity/app.env"
  cp "$CASE_ROOT/etc/precommunity/app.env" "$CASE_ROOT/active-before"
  cp "$CASE_ROOT/common.env" "$CASE_ROOT/etc/precommunity/app.env.next"
  printf 'ADS_CONTRACT_ADDRESS=0x7777777777777777777777777777777777777777\nADS_CONTRACT_DEPLOYMENT_BLOCK=200\n' >>"$CASE_ROOT/etc/precommunity/app.env.next"
  printf '{"keywordMarket":{"abiSha256":"abi-fixture","artifactSha256":"artifact-fixture","buildInfoId":"build-fixture"}}\n' >"$RELEASE_DIR/release-manifest.json"
  : >"$RELEASE_DIR/apps/worker/dist/check-keyword-market.js"
  cat >"$RELEASE_DIR/ops/activate-release.sh" <<'MOCK'
#!/usr/bin/env bash
printf 'ACTIVATE %s\n' "$1" >>"$CUTOVER_TEST_LOG"
systemctl restart precommunity-api.service precommunity-worker.service precommunity-web.service
MOCK
}

run_case() {
  env -i PATH="$TEST_ROOT/bin:/usr/bin:/bin" TMPDIR="$CASE_ROOT/tmp" \
    CUTOVER_TEST_CASE="$CASE_ROOT" CUTOVER_TEST_LOG="$LOG" CUTOVER_TEST_REAL_NODE="$NODE_BINARY" \
    PRECOMMUNITY_MAINTENANCE_CONFIRMED=1 "$@" \
    bash "$RELEASE_DIR/ops/cutover-keyword-market.sh" "$RELEASE_DIR" >"$CASE_ROOT/output.log" 2>&1
}

assert_not_promoted() {
  cmp -s "$CASE_ROOT/active-before" "$CASE_ROOT/etc/precommunity/app.env" || { echo 'Failure promoted staged configuration.' >&2; exit 1; }
  if grep -Eq '^(ACTIVATE|SYSTEMCTL (start|restart)) ' "$LOG"; then echo 'Failure activated application services.' >&2; exit 1; fi
}

prepare_case active-worker
if run_case CUTOVER_TEST_ACTIVE_STATE=active; then echo 'A running worker was accepted.' >&2; exit 1; fi
assert_not_promoted
if grep -Eq '^(PG_DUMP|PNPM) ' "$LOG"; then echo 'Running worker refusal occurred after database work.' >&2; exit 1; fi

prepare_case exiting-worker
if run_case CUTOVER_TEST_WORKER_PID=123; then echo 'A worker process still exiting was accepted.' >&2; exit 1; fi
assert_not_promoted
if grep -Eq '^(PG_DUMP|PNPM) ' "$LOG"; then echo 'Exiting worker refusal occurred after database work.' >&2; exit 1; fi

prepare_case failed-restore
if run_case CUTOVER_TEST_FAIL_RESTORE=1; then echo 'An unrestorable backup was accepted.' >&2; exit 1; fi
assert_not_promoted
if grep -Fq 'PNPM db:deploy' "$LOG"; then echo 'Migration ran before backup restore verification succeeded.' >&2; exit 1; fi

prepare_case failed-migration
if run_case CUTOVER_TEST_FAIL_MIGRATION=1; then echo 'A failed migration was accepted.' >&2; exit 1; fi
assert_not_promoted
grep -Fq 'Keep maintenance active' "$CASE_ROOT/output.log"

for invalid_phase in invalid ''; do
  prepare_case "invalid-phase-${invalid_phase:-empty}"
  if run_case "KEYWORD_MARKET_RELEASE_PHASE=$invalid_phase"; then echo 'An invalid release phase was accepted.' >&2; exit 1; fi
  assert_not_promoted
  if [[ -s "$LOG" ]]; then echo 'Invalid phase performed service or database work.' >&2; exit 1; fi
done

prepare_case paused-active-readiness
if run_case CUTOVER_TEST_PAUSED=true; then echo 'A paused active deployment was accepted.' >&2; exit 1; fi
assert_not_promoted

prepare_case unpaused-preopen-readiness
if run_case KEYWORD_MARKET_RELEASE_PHASE=preopen CUTOVER_TEST_EXPECT_PHASE=preopen; then echo 'An unpaused preopen deployment was accepted.' >&2; exit 1; fi
assert_not_promoted

prepare_case wrong-readiness-phase
if run_case CUTOVER_TEST_RETURN_PHASE=preopen; then echo 'A mismatched readiness phase was accepted.' >&2; exit 1; fi
assert_not_promoted

prepare_case wrong-artifact
if run_case CUTOVER_TEST_ABI=wrong-artifact; then echo 'A mismatched release artifact was accepted.' >&2; exit 1; fi
assert_not_promoted

prepare_case success
run_case
cmp -s "$CASE_ROOT/etc/precommunity/app.env.next" "$CASE_ROOT/etc/precommunity/app.env"
grep -Fq 'ACTIVATE ' "$LOG"
grep -Fq 'NODE apps/worker/dist/backfill.js --phase active' "$LOG"
grep -Fq 'NODE apps/worker/dist/check-keyword-market.js --phase active' "$LOG"
grep -Fq '"keywordMarketEnabled" = false' "$LOG"
grep -Fq 'market phase active, application feature remains disabled' "$CASE_ROOT/output.log"
if grep -Fq 'then Safe unpause' "$CASE_ROOT/output.log"; then echo 'Active release required Safe unpause.' >&2; exit 1; fi
dump_line="$(grep -n '^PG_DUMP ' "$LOG" | cut -d: -f1)"
restore_line="$(grep -n '^PG_RESTORE .*--exit-on-error' "$LOG" | cut -d: -f1)"
migration_line="$(grep -n '^PNPM db:deploy' "$LOG" | cut -d: -f1)"
if (( dump_line >= restore_line || restore_line >= migration_line )); then echo 'Backup/restore did not precede migration.' >&2; exit 1; fi

prepare_case paused-success
run_case KEYWORD_MARKET_RELEASE_PHASE=preopen CUTOVER_TEST_EXPECT_PHASE=preopen CUTOVER_TEST_PAUSED=true
cmp -s "$CASE_ROOT/etc/precommunity/app.env.next" "$CASE_ROOT/etc/precommunity/app.env"
grep -Fq 'NODE apps/worker/dist/backfill.js --phase preopen' "$LOG"
grep -Fq 'NODE apps/worker/dist/check-keyword-market.js --phase preopen' "$LOG"
grep -Fq 'market phase preopen, application feature remains disabled' "$CASE_ROOT/output.log"
grep -Fq 'then Safe unpause' "$CASE_ROOT/output.log"

prepare_case zero-previous-market
printf 'ADS_CONTRACT_ADDRESS=0x0000000000000000000000000000000000000000\n' >>"$CASE_ROOT/etc/precommunity/app.env"
run_case
grep -Fq 'ACTIVATE ' "$LOG"

prepare_case preserved-live-market
printf 'ADS_CONTRACT_ADDRESS=0x7777777777777777777777777777777777777777\nADS_CONTRACT_DEPLOYMENT_BLOCK=200\n' >>"$CASE_ROOT/etc/precommunity/app.env"
run_case
grep -Fq 'ACTIVATE ' "$LOG"

prepare_case live-market-replacement
printf 'ADS_CONTRACT_ADDRESS=0x8888888888888888888888888888888888888888\nADS_CONTRACT_DEPLOYMENT_BLOCK=150\n' >>"$CASE_ROOT/etc/precommunity/app.env"
cp "$CASE_ROOT/etc/precommunity/app.env" "$CASE_ROOT/active-before"
if run_case; then echo 'A different live market was replaced.' >&2; exit 1; fi
assert_not_promoted
if grep -Eq '^(PG_DUMP|PNPM) ' "$LOG"; then echo 'Live market refusal occurred after database work.' >&2; exit 1; fi
printf 'Hermetic Keyword Market cutover tests passed.\n'
