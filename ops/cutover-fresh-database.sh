#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

readonly RELEASE_DIR="${1:-}"
readonly RELEASES_ROOT=/srv/precommunity/releases
readonly NVM_DIR=/home/ubuntu/.nvm
readonly NODE_RUNTIME=/home/ubuntu/.local/bin/precommunity-node
readonly BACKUP_DIR=/var/backups/precommunity/postgresql
readonly ACTIVE_ENV_FILE=/etc/precommunity/app.env
readonly STAGED_ENV_FILE=/etc/precommunity/app.env.mainnet-next
readonly UNITS=(precommunity-web.service precommunity-worker.service precommunity-api.service)

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
if [[ ! -r /etc/precommunity/data-services.env || ! -r "$STAGED_ENV_FILE" ]]; then
  echo 'The application environment files are missing or unreadable.' >&2
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
# Both files are generated locally on the VPS and contain shell-safe values.
# shellcheck disable=SC1091
source /etc/precommunity/data-services.env
# shellcheck disable=SC1091
source "$STAGED_ENV_FILE"
set +a
# redis-cli on this host treats an empty username in redis://:password@host as
# a two-argument AUTH request. Read the same root-owned password used by Redis
# and authenticate through REDISCLI_AUTH instead.
# shellcheck disable=SC1090
source <(sudo cat /etc/precommunity/data-services.secrets)
: "${REDIS_PASSWORD:?Missing REDIS_PASSWORD}"

if [[ "${PRECOMMUNITY_NETWORK:-}" != base ]]; then
  echo 'Refusing to replace the database unless PRECOMMUNITY_NETWORK=base.' >&2
  exit 1
fi
cd "$RELEASE_DIR"
printf 'Verifying the exact escrow contract manifest...\n'
pnpm --filter @precommunity/worker check-chain-source

"$NODE_RUNTIME" --input-type=module <<'NODE'
const rpcUrl = process.env.BASE_RPC_URL;
const escrowAddress = process.env.PUBLIC_ESCROW_ADDRESS;
const preAddress = process.env.PUBLIC_PRE_ADDRESS;
const deploymentBlock = BigInt(process.env.PUBLIC_ESCROW_DEPLOYMENT_BLOCK);

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error('Base RPC returned HTTP ' + response.status);
  const payload = await response.json();
  if (payload.error) {
    throw new Error('Base RPC ' + method + ' failed with code ' + payload.error.code);
  }
  return payload.result;
}

const chainId = await rpc('eth_chainId', []);
const head = BigInt(await rpc('eth_blockNumber', []));
const blockTag = '0x' + deploymentBlock.toString(16);
const code = await rpc('eth_getCode', [escrowAddress, blockTag]);
const historicalBalance = await rpc('eth_call', [
  { to: preAddress, data: '0x70a08231' + '0'.repeat(64) },
  blockTag,
]);
if (chainId !== '0x2105') throw new Error('Expected Base chain ID 8453, received ' + chainId);
if (head < deploymentBlock) throw new Error('Base RPC head is behind the escrow deployment block');
if (!code || code === '0x') throw new Error('Escrow bytecode is missing at the deployment block');
if (typeof historicalBalance !== 'string' || !historicalBalance.startsWith('0x')) {
  throw new Error('Base RPC does not support the required historical PRE balance read');
}
console.log('Verified Base RPC at block ' + head + '; historical reads are available.');
NODE

database_target="$("$NODE_RUNTIME" -e '
  const url = new URL(process.env.DATABASE_URL);
  const port = url.port || "5432";
  process.stdout.write([url.protocol, url.hostname, port, url.pathname.slice(1), url.username].join("|"));
')"
if [[ "$database_target" != 'postgresql:|127.0.0.1|5432|precommunity|precommunity' ]]; then
  echo "Refusing to replace unexpected database target: $database_target" >&2
  exit 1
fi

redis_target="$("$NODE_RUNTIME" -e '
  const url = new URL(process.env.REDIS_URL);
  const port = url.port || "6379";
  const database = url.pathname === "" || url.pathname === "/" ? "0" : url.pathname.slice(1);
  process.stdout.write([url.protocol, url.hostname, port, database].join("|"));
')"
if [[ "$redis_target" != 'redis:|127.0.0.1|6379|0' ]]; then
  echo "Refusing to clear queues on unexpected Redis target: $redis_target" >&2
  exit 1
fi

services_stopped=0
database_replaced=0
readonly CUTOVER_BASHPID="$BASHPID"
recover_before_reset() {
  if [[ "$BASHPID" != "$CUTOVER_BASHPID" ]]; then
    return
  fi
  if [[ "$services_stopped" == 1 && "$database_replaced" == 0 ]]; then
    sudo systemctl start "${UNITS[@]}" || true
  elif [[ "$services_stopped" == 1 ]]; then
    echo 'Cutover failed after replacing the database; services remain stopped to prevent a partial mainnet launch.' >&2
  fi
}
trap recover_before_reset ERR INT TERM

printf 'Stopping application services for the clean Base mainnet cutover...\n'
sudo systemctl stop "${UNITS[@]}"
services_stopped=1

printf 'Creating and verifying a final PostgreSQL safety backup...\n'
sudo systemctl start precommunity-postgres-backup.service
latest_backup="$(sudo find "$BACKUP_DIR" -maxdepth 1 -type f -name 'precommunity-*.dump' -print | sort | tail -1)"
if [[ -z "$latest_backup" ]]; then
  echo 'No PostgreSQL backup was created.' >&2
  exit 1
fi
sudo -u postgres pg_restore --list "$latest_backup" >/dev/null

printf 'Removing only precommunity BullMQ keys from Redis database 0...\n'
redis_ping="$(
  REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning \
    -h 127.0.0.1 -p 6379 PING
)"
if [[ "$redis_ping" != PONG ]]; then
  echo 'Redis authentication failed before queue cleanup.' >&2
  exit 1
fi
redis_keys="$(
  REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning \
    -h 127.0.0.1 -p 6379 --scan --pattern 'bull:precommunity-*'
)"
deleted_redis_keys=0
while IFS= read -r redis_key; do
  [[ -n "$redis_key" ]] || continue
  REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning \
    -h 127.0.0.1 -p 6379 DEL "$redis_key" >/dev/null
  deleted_redis_keys=$((deleted_redis_keys + 1))
done <<<"$redis_keys"

printf 'Replacing PostgreSQL database precommunity...\n'
sudo -u postgres psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname=postgres <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'precommunity' AND pid <> pg_backend_pid();
DROP DATABASE precommunity;
CREATE DATABASE precommunity OWNER precommunity;
ALTER DATABASE precommunity SET timezone TO 'UTC';
REVOKE ALL ON DATABASE precommunity FROM PUBLIC;
GRANT CONNECT ON DATABASE precommunity TO precommunity;
SQL
sudo -u postgres psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname=precommunity <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO precommunity;
SQL
database_replaced=1

printf 'Promoting the staged Base mainnet runtime configuration...\n'
sudo install -o root -g "$(id -gn)" -m 0640 "$STAGED_ENV_FILE" "$ACTIVE_ENV_FILE"

cd "$RELEASE_DIR"
printf 'Applying production database migrations...\n'
pnpm db:deploy
printf 'Creating the application project record...\n'
pnpm db:seed

printf 'Backfilling the escrow and reconciling both tokens...\n'
pnpm worker:backfill

printf 'Activating the Base mainnet release...\n'
bash "$RELEASE_DIR/ops/activate-release.sh" "$RELEASE_DIR"
services_stopped=0
trap - ERR INT TERM

printf 'Clean Base mainnet cutover completed. Safety backup: %s; removed Redis keys: %s.\n' \
  "$latest_backup" "$deleted_redis_keys"
