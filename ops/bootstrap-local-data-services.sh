#!/usr/bin/env bash

set -Eeuo pipefail

readonly PG_HOST="${PRECOMMUNITY_PG_HOST:-127.0.0.1}"
readonly PG_PORT="${PRECOMMUNITY_PG_PORT:-5432}"
readonly PG_ADMIN_USER="${PRECOMMUNITY_PG_ADMIN_USER:-$(id -un)}"
readonly PG_ADMIN_DATABASE="${PRECOMMUNITY_PG_ADMIN_DATABASE:-postgres}"
readonly PG_ADMIN_PASSWORD="${PRECOMMUNITY_PG_ADMIN_PASSWORD:-}"
readonly APP_DB_USER="${PRECOMMUNITY_DB_USER:-precommunity}"
readonly APP_DB_NAME="${PRECOMMUNITY_DB_NAME:-precommunity}"
readonly APP_DB_PASSWORD="${PRECOMMUNITY_DB_PASSWORD:-precommunity}"
readonly REDIS_HOST="${PRECOMMUNITY_REDIS_HOST:-127.0.0.1}"
readonly REDIS_PORT="${PRECOMMUNITY_REDIS_PORT:-6379}"
readonly REDIS_PASSWORD="${PRECOMMUNITY_REDIS_PASSWORD:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

run_admin_psql() {
  if [[ -n "$PG_ADMIN_PASSWORD" ]]; then
    PGPASSWORD="$PG_ADMIN_PASSWORD" psql "$@"
  else
    psql "$@"
  fi
}

require_command pg_isready
require_command psql
require_command redis-cli

if ! pg_isready --host="$PG_HOST" --port="$PG_PORT" >/dev/null; then
  printf 'PostgreSQL is not accepting connections on %s:%s.\n' "$PG_HOST" "$PG_PORT" >&2
  exit 1
fi

if [[ -n "$REDIS_PASSWORD" ]]; then
  redis_ping="$(REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning -h "$REDIS_HOST" -p "$REDIS_PORT" ping)"
else
  redis_ping="$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping)"
fi

if [[ "$redis_ping" != PONG ]]; then
  printf 'Redis did not return PONG on %s:%s.\n' "$REDIS_HOST" "$REDIS_PORT" >&2
  exit 1
fi

run_admin_psql \
  --host="$PG_HOST" \
  --port="$PG_PORT" \
  --username="$PG_ADMIN_USER" \
  --dbname="$PG_ADMIN_DATABASE" \
  --set=ON_ERROR_STOP=1 \
  --set=app_db_user="$APP_DB_USER" \
  --set=app_db_name="$APP_DB_NAME" \
  --set=app_db_password="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_db_user', :'app_db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_db_user')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 30',
  :'app_db_user',
  :'app_db_password'
)
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'app_db_name', :'app_db_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_db_name')
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', :'app_db_name', :'app_db_user')
\gexec
SELECT format('ALTER DATABASE %I SET timezone TO %L', :'app_db_name', 'UTC')
\gexec
SQL

PGPASSWORD="$APP_DB_PASSWORD" psql \
  --host="$PG_HOST" \
  --port="$PG_PORT" \
  --username="$APP_DB_USER" \
  --dbname="$APP_DB_NAME" \
  --set=ON_ERROR_STOP=1 \
  --set=app_db_user="$APP_DB_USER" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT ALL ON SCHEMA public TO %I', :'app_db_user')
\gexec
SELECT current_user, current_database();
SQL

printf 'Local PostgreSQL and Redis are ready.\n'
