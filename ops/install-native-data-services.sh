#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

readonly APP_USER="${PRECOMMUNITY_APP_USER:-ubuntu}"
readonly APP_DB_USER=precommunity
readonly APP_DB_NAME=precommunity
readonly SECRETS_DIR=/etc/precommunity
readonly SECRETS_FILE="${SECRETS_DIR}/data-services.secrets"
readonly RUNTIME_ENV_FILE="${SECRETS_DIR}/data-services.env"
readonly BACKUP_DIR=/var/backups/precommunity/postgresql

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
else
  sudo -v
  SUDO=(sudo)
fi

run_root() {
  "${SUDO[@]}" "$@"
}

run_as() {
  local user="$1"
  shift
  if [[ "$(id -u)" -eq 0 ]]; then
    runuser -u "$user" -- "$@"
  else
    sudo -u "$user" "$@"
  fi
}

if ! getent passwd "$APP_USER" >/dev/null; then
  echo "Application user '$APP_USER' does not exist." >&2
  exit 1
fi
readonly APP_GROUP="$(id -gn "$APP_USER")"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

echo "==> Installing PostgreSQL and Redis from Ubuntu repositories"
run_root apt-get update
run_root apt-get install -y postgresql postgresql-contrib redis-server

PG_MAJOR="$(run_root pg_lsclusters --no-header | awk 'NR == 1 { print $1 }')"
if [[ -z "$PG_MAJOR" ]]; then
  echo "No PostgreSQL cluster was created by the package." >&2
  exit 1
fi
readonly PG_MAJOR
readonly PG_CONFIG_DIR="/etc/postgresql/${PG_MAJOR}/main"
readonly PG_HBA="${PG_CONFIG_DIR}/pg_hba.conf"

echo "==> Creating application secrets without printing them"
run_root install -d -o root -g "$APP_GROUP" -m 0750 "$SECRETS_DIR"
if ! run_root test -f "$SECRETS_FILE"; then
  db_password="$(openssl rand -hex 32)"
  redis_password="$(openssl rand -hex 32)"
  secrets_tmp="$(mktemp)"
  trap 'rm -f "${secrets_tmp:-}" "${runtime_tmp:-}" "${pgpass_file:-}"' EXIT
  {
    printf "DB_PASSWORD='%s'\n" "$db_password"
    printf "REDIS_PASSWORD='%s'\n" "$redis_password"
  } >"$secrets_tmp"
  run_root install -o root -g root -m 0600 "$secrets_tmp" "$SECRETS_FILE"
  rm -f "$secrets_tmp"
fi

# The file contains only shell-safe hexadecimal values generated above.
# shellcheck disable=SC1090
source <(run_root cat "$SECRETS_FILE")
: "${DB_PASSWORD:?Missing DB_PASSWORD}"
: "${REDIS_PASSWORD:?Missing REDIS_PASSWORD}"

runtime_tmp="$(mktemp)"
trap 'rm -f "${secrets_tmp:-}" "${runtime_tmp:-}" "${pgpass_file:-}"' EXIT
{
  printf 'DATABASE_URL="postgresql://%s:%s@127.0.0.1:5432/%s?schema=public&sslmode=disable"\n' \
    "$APP_DB_USER" "$DB_PASSWORD" "$APP_DB_NAME"
  printf 'REDIS_URL="redis://:%s@127.0.0.1:6379"\n' "$REDIS_PASSWORD"
} >"$runtime_tmp"
run_root install -o root -g "$APP_GROUP" -m 0640 "$runtime_tmp" "$RUNTIME_ENV_FILE"
rm -f "$runtime_tmp"

echo "==> Restricting PostgreSQL to loopback with SCRAM authentication"
run_root install -d -o postgres -g postgres -m 0750 "${PG_CONFIG_DIR}/conf.d"
run_root tee "${PG_CONFIG_DIR}/conf.d/99-precommunity.conf" >/dev/null <<'EOF'
listen_addresses = '127.0.0.1,::1'
password_encryption = 'scram-sha-256'
max_connections = 100
shared_buffers = '512MB'
effective_cache_size = '2GB'
maintenance_work_mem = '128MB'
work_mem = '8MB'
wal_compression = on
idle_in_transaction_session_timeout = '60s'
log_min_duration_statement = 1000
log_checkpoints = on
log_lock_waits = on
EOF
run_root chown postgres:postgres "${PG_CONFIG_DIR}/conf.d/99-precommunity.conf"
run_root chmod 0640 "${PG_CONFIG_DIR}/conf.d/99-precommunity.conf"

if ! run_root test -e "${PG_HBA}.precommunity-backup"; then
  run_root cp -a "$PG_HBA" "${PG_HBA}.precommunity-backup"
fi
run_root tee "$PG_HBA" >/dev/null <<'EOF'
# Local administration uses the operating-system identity.
local   all             postgres                                peer
local   all             all                                     peer

# Applications authenticate with SCRAM, and only over loopback.
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
EOF
run_root chown postgres:postgres "$PG_HBA"
run_root chmod 0640 "$PG_HBA"

run_root pg_ctlcluster "$PG_MAJOR" main restart
run_as postgres psql --no-psqlrc --set=ON_ERROR_STOP=1 --set=db_password="$DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE precommunity LOGIN PASSWORD %L', :'db_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'precommunity')
\gexec
SELECT format('ALTER ROLE precommunity PASSWORD %L', :'db_password')
\gexec
ALTER ROLE precommunity NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 30;
SELECT 'CREATE DATABASE precommunity OWNER precommunity'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'precommunity')
\gexec
ALTER DATABASE precommunity OWNER TO precommunity;
ALTER DATABASE precommunity SET timezone TO 'UTC';
REVOKE ALL ON DATABASE precommunity FROM PUBLIC;
GRANT CONNECT ON DATABASE precommunity TO precommunity;
SQL

run_as postgres psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname="$APP_DB_NAME" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO precommunity;
SQL

echo "==> Restricting Redis to loopback with authentication and AOF persistence"
readonly REDIS_CONFIG=/etc/redis/redis.conf
readonly REDIS_DROP_IN_DIR=/etc/redis/redis.conf.d
readonly REDIS_DROP_IN="${REDIS_DROP_IN_DIR}/99-precommunity.conf"
if ! run_root test -e "${REDIS_CONFIG}.precommunity-backup"; then
  run_root cp -a "$REDIS_CONFIG" "${REDIS_CONFIG}.precommunity-backup"
fi
run_root install -d -o root -g redis -m 0750 "$REDIS_DROP_IN_DIR"
if ! run_root grep -Fqx "include ${REDIS_DROP_IN_DIR}/*.conf" "$REDIS_CONFIG"; then
  printf '\ninclude %s/*.conf\n' "$REDIS_DROP_IN_DIR" | run_root tee -a "$REDIS_CONFIG" >/dev/null
fi
run_root tee "$REDIS_DROP_IN" >/dev/null <<EOF
bind 127.0.0.1 ::1
protected-mode yes
port 6379
requirepass ${REDIS_PASSWORD}
appendonly yes
appendfsync everysec
maxmemory 512mb
maxmemory-policy noeviction
EOF
run_root chown root:redis "$REDIS_DROP_IN"
run_root chmod 0640 "$REDIS_DROP_IN"
run_root systemctl enable --now redis-server
run_root systemctl restart redis-server

echo "==> Installing a daily local PostgreSQL backup timer"
run_root install -d -o root -g postgres -m 0750 /var/backups/precommunity
run_root install -d -o postgres -g postgres -m 0700 "$BACKUP_DIR"
run_root tee /usr/local/sbin/precommunity-postgres-backup >/dev/null <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly backup_dir=/var/backups/precommunity/postgresql
readonly timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
readonly temporary="${backup_dir}/.precommunity-${timestamp}.dump.tmp"
readonly destination="${backup_dir}/precommunity-${timestamp}.dump"

trap 'rm -f "$temporary"' EXIT
pg_dump --dbname=precommunity --format=custom --compress=gzip:6 --file="$temporary"
mv "$temporary" "$destination"
find "$backup_dir" -maxdepth 1 -type f -name 'precommunity-*.dump' -mtime +7 -delete
EOF
run_root chown root:root /usr/local/sbin/precommunity-postgres-backup
run_root chmod 0755 /usr/local/sbin/precommunity-postgres-backup

run_root tee /etc/systemd/system/precommunity-postgres-backup.service >/dev/null <<'EOF'
[Unit]
Description=Back up the precommunity PostgreSQL database
After=postgresql.service
Requires=postgresql.service

[Service]
Type=oneshot
User=postgres
Group=postgres
ExecStart=/usr/local/sbin/precommunity-postgres-backup
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
PrivateTmp=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/backups/precommunity/postgresql
EOF

run_root tee /etc/systemd/system/precommunity-postgres-backup.timer >/dev/null <<'EOF'
[Unit]
Description=Run the precommunity PostgreSQL backup daily

[Timer]
OnCalendar=*-*-* 03:15:00 UTC
RandomizedDelaySec=30m
Persistent=true
Unit=precommunity-postgres-backup.service

[Install]
WantedBy=timers.target
EOF
run_root systemctl daemon-reload
run_root systemctl enable --now postgresql redis-server precommunity-postgres-backup.timer
run_root systemctl start precommunity-postgres-backup.service

echo "==> Verifying authentication, persistence, listeners, and backups"
pgpass_file="$(mktemp)"
printf '127.0.0.1:5432:%s:%s:%s\n' "$APP_DB_NAME" "$APP_DB_USER" "$DB_PASSWORD" >"$pgpass_file"
chmod 0600 "$pgpass_file"
PGPASSFILE="$pgpass_file" psql \
  --host=127.0.0.1 \
  --username="$APP_DB_USER" \
  --dbname="$APP_DB_NAME" \
  --no-psqlrc \
  --tuples-only \
  --command='SELECT current_user, current_database();'
rm -f "$pgpass_file"

REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning ping
REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli --no-auth-warning CONFIG GET bind protected-mode appendonly maxmemory maxmemory-policy

run_root systemctl --no-pager --full status postgresql redis-server precommunity-postgres-backup.timer | sed -n '1,90p'
run_root ss -lntp | grep -E ':(5432|6379)[[:space:]]'
run_as postgres psql --no-psqlrc --tuples-only --command='SHOW listen_addresses; SHOW password_encryption;'

latest_backup="$(run_root find "$BACKUP_DIR" -maxdepth 1 -type f -name 'precommunity-*.dump' -print | sort | tail -1)"
run_as postgres pg_restore --list "$latest_backup" >/dev/null
printf 'Verified backup: %s\n' "$latest_backup"
printf 'Runtime environment: %s (root:%s, mode 0640)\n' "$RUNTIME_ENV_FILE" "$APP_GROUP"
echo "Native PostgreSQL and Redis setup complete. No database secret was printed."
