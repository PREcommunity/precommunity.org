#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

readonly TARGET_USER="${PRECOMMUNITY_USER:-ubuntu}"
readonly SSH_PORT="${PRECOMMUNITY_SSH_PORT:-22222}"
readonly NVM_VERSION="v0.40.6"
readonly NVM_INSTALL_SHA256="2ef7e8d4373c1ffd70daa55f919f629e98a619543ffc0a8d892d77a5247e50e4"
readonly NODE_MAJOR="22"
readonly PNPM_VERSION="11.9.0"

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
else
  sudo -v
  SUDO=(sudo)
fi

run_root() {
  "${SUDO[@]}" "$@"
}

run_target() {
  if [[ "$(id -u)" -eq 0 ]]; then
    runuser -u "$TARGET_USER" -- env HOME="$TARGET_HOME" "$@"
  else
    sudo -u "$TARGET_USER" -H "$@"
  fi
}

if [[ ! -r /etc/os-release ]]; then
  echo "Cannot identify the operating system." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This bootstrap supports Ubuntu only; detected: ${PRETTY_NAME:-unknown}." >&2
  exit 1
fi

if ! getent passwd "$TARGET_USER" >/dev/null; then
  echo "Expected deployment user '$TARGET_USER' does not exist." >&2
  exit 1
fi

TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
AUTHORIZED_KEYS="${TARGET_HOME}/.ssh/authorized_keys"

# Never disable password authentication unless at least one public key is present.
if ! run_root test -f "$AUTHORIZED_KEYS" || \
  ! run_root grep -Eq '^(ssh-ed25519|sk-ssh-ed25519@openssh.com|ecdsa-sha2-nistp(256|384|521)|sk-ecdsa-sha2-nistp256@openssh.com|ssh-rsa)[[:space:]]' "$AUTHORIZED_KEYS"; then
  echo "No public key found in $AUTHORIZED_KEYS. Add and test a key first." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

echo "==> Updating Ubuntu and installing base packages"
run_root apt-get update
run_root apt-get -y full-upgrade
run_root apt-get install -y \
  apt-listchanges \
  build-essential \
  ca-certificates \
  curl \
  fail2ban \
  git \
  jq \
  needrestart \
  nginx \
  python3-systemd \
  ufw \
  unattended-upgrades

echo "==> Ensuring a 2 GiB swap file is available for application builds"
if ! run_root swapon --noheadings --show=NAME | grep -qx '/swapfile'; then
  if run_root test -e /swapfile; then
    echo "/swapfile already exists but is not active; refusing to overwrite it." >&2
    exit 1
  fi
  run_root fallocate -l 2G /swapfile
  run_root chmod 0600 /swapfile
  run_root mkswap /swapfile >/dev/null
  run_root swapon /swapfile
fi
if ! run_root grep -Eq '^[[:space:]]*/swapfile[[:space:]]' /etc/fstab; then
  printf '%s\n' '/swapfile none swap sw 0 0' | run_root tee -a /etc/fstab >/dev/null
fi

echo "==> Enabling automatic security updates"
run_root install -o root -g root -m 0644 /dev/null /etc/apt/apt.conf.d/20auto-upgrades
run_root tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

run_root install -o root -g root -m 0644 /dev/null /etc/apt/apt.conf.d/52precommunity-security
run_root tee /etc/apt/apt.conf.d/52precommunity-security >/dev/null <<'EOF'
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF
run_root systemctl enable --now apt-daily.timer apt-daily-upgrade.timer

echo "==> Applying conservative kernel/network hardening"
run_root install -o root -g root -m 0644 /dev/null /etc/sysctl.d/99-precommunity-hardening.conf
run_root tee /etc/sysctl.d/99-precommunity-hardening.conf >/dev/null <<'EOF'
fs.protected_fifos = 2
fs.protected_hardlinks = 1
fs.protected_regular = 2
fs.protected_symlinks = 1
fs.suid_dumpable = 0
kernel.dmesg_restrict = 1
kernel.kptr_restrict = 2
kernel.randomize_va_space = 2
kernel.yama.ptrace_scope = 1
vm.swappiness = 10
vm.vfs_cache_pressure = 50
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.default.log_martians = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.default.secure_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv4.tcp_syncookies = 1
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv6.conf.default.accept_source_route = 0
EOF
run_root sysctl --system >/dev/null

echo "==> Configuring persistent, size-bounded system logs"
run_root mkdir -p /etc/systemd/journald.conf.d /var/log/journal
run_root install -o root -g root -m 0644 /dev/null /etc/systemd/journald.conf.d/10-precommunity.conf
run_root tee /etc/systemd/journald.conf.d/10-precommunity.conf >/dev/null <<'EOF'
[Journal]
Storage=persistent
Compress=yes
SystemMaxUse=500M
MaxRetentionSec=1month
EOF
run_root systemd-tmpfiles --create --prefix /var/log/journal
run_root systemctl restart systemd-journald

echo "==> Configuring Nginx bootstrap site"
run_root mkdir -p /var/www/precommunity-bootstrap
if ! run_root test -e /etc/nginx/nginx.conf.precommunity-backup; then
  run_root cp -a /etc/nginx/nginx.conf /etc/nginx/nginx.conf.precommunity-backup
fi
run_root sed -Ei 's/^([[:space:]]*)server_tokens[[:space:]]+[^;]+;/\1server_tokens off;/' /etc/nginx/nginx.conf
run_root install -o root -g root -m 0644 /dev/null /etc/nginx/conf.d/10-precommunity-security.conf
run_root tee /etc/nginx/conf.d/10-precommunity-security.conf >/dev/null <<'EOF'
limit_req_zone $binary_remote_addr zone=precommunity_per_ip:10m rate=15r/s;
limit_req_zone $binary_remote_addr zone=precommunity_keyword_market_resolve:10m rate=60r/s;
log_format precommunity_keyword_market '[$time_local] "$request_method $uri $server_protocol" '
                                       '$status $body_bytes_sent "$http_user_agent"';
EOF

run_root install -o root -g root -m 0644 /dev/null /etc/nginx/sites-available/precommunity-bootstrap
run_root tee /etc/nginx/sites-available/precommunity-bootstrap >/dev/null <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    access_log /var/log/nginx/precommunity.access.log;
    error_log /var/log/nginx/precommunity.error.log warn;

    client_max_body_size 2m;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Permissions-Policy "camera=(), geolocation=(), microphone=()" always;

    location = /healthz {
        access_log off;
        default_type text/plain;
        return 200 "ok\n";
    }

    location / {
        limit_req zone=precommunity_per_ip burst=45 nodelay;
        default_type text/plain;
        return 200 "precommunity VPS ready\n";
    }

    location ~ /\. {
        deny all;
    }
}
EOF
run_root rm -f /etc/nginx/sites-enabled/default
run_root ln -sfn /etc/nginx/sites-available/precommunity-bootstrap /etc/nginx/sites-enabled/precommunity-bootstrap
run_root nginx -t
run_root systemctl enable --now nginx
run_root systemctl reload nginx

echo "==> Configuring UFW before SSH hardening"
run_root sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw
run_root ufw default deny incoming
run_root ufw default allow outgoing
run_root ufw limit "${SSH_PORT}/tcp" comment 'SSH rate limit'
run_root ufw allow 'Nginx Full'
run_root ufw logging low
run_root ufw --force enable

echo "==> Configuring Fail2ban"
run_root mkdir -p /etc/fail2ban/jail.d
run_root install -o root -g root -m 0644 /dev/null /etc/fail2ban/jail.d/precommunity.local
run_root tee /etc/fail2ban/jail.d/precommunity.local >/dev/null <<EOF
[DEFAULT]
backend = systemd
banaction = ufw
bantime = 1h
bantime.increment = true
bantime.factor = 2
bantime.maxtime = 1w
findtime = 10m
maxretry = 5
usedns = no

[sshd]
enabled = true
port = ${SSH_PORT}
EOF
run_root fail2ban-client -t
run_root systemctl enable --now fail2ban
run_root systemctl restart fail2ban

echo "==> Hardening OpenSSH"
# Ubuntu cloud images often set PasswordAuthentication in 50-cloud-init.conf.
# OpenSSH uses the first value it reads, so this file must sort before it.
run_root mkdir -p /etc/ssh/sshd_config.d
run_root install -o root -g root -m 0644 /dev/null /etc/ssh/sshd_config.d/00-precommunity-hardening.conf
run_root tee /etc/ssh/sshd_config.d/00-precommunity-hardening.conf >/dev/null <<'EOF'
PermitRootLogin no
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitEmptyPasswords no
X11Forwarding no
AllowAgentForwarding no
LoginGraceTime 30
MaxAuthTries 3
MaxSessions 5
MaxStartups 10:30:60
ClientAliveInterval 300
ClientAliveCountMax 2
UseDNS no
DebianBanner no
EOF

printf 'Port %s\n' "$SSH_PORT" | run_root tee /etc/ssh/sshd_config.d/00-precommunity-port.conf >/dev/null
run_root chmod 0644 /etc/ssh/sshd_config.d/00-precommunity-port.conf

run_root sshd -t
effective_sshd="$(run_root sshd -T -C "user=${TARGET_USER},host=$(hostname),addr=127.0.0.1")"
grep -q "^port ${SSH_PORT}$" <<<"$effective_sshd"
grep -q '^passwordauthentication no$' <<<"$effective_sshd"
grep -q '^kbdinteractiveauthentication no$' <<<"$effective_sshd"
grep -q '^permitrootlogin no$' <<<"$effective_sshd"

run_root mkdir -p /etc/systemd/system/ssh.socket.d
run_root tee /etc/systemd/system/ssh.socket.d/10-precommunity-listen.conf >/dev/null <<EOF
[Socket]
ListenStream=
ListenStream=0.0.0.0:${SSH_PORT}
ListenStream=[::]:${SSH_PORT}
EOF
run_root chmod 0644 /etc/systemd/system/ssh.socket.d/10-precommunity-listen.conf
run_root sshd -t
run_root systemctl daemon-reload
run_root systemctl restart ssh.socket

echo "==> Installing nvm ${NVM_VERSION}, Node ${NODE_MAJOR}, and pnpm ${PNPM_VERSION}"
nvm_installer="$(mktemp)"
trap 'rm -f "$nvm_installer"' EXIT
curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" -o "$nvm_installer"
printf '%s  %s\n' "$NVM_INSTALL_SHA256" "$nvm_installer" | sha256sum -c -
chmod 0644 "$nvm_installer"

run_target env \
  NVM_DIR="${TARGET_HOME}/.nvm" \
  PROFILE="${TARGET_HOME}/.bashrc" \
  bash "$nvm_installer"

run_target env \
  NVM_DIR="${TARGET_HOME}/.nvm" \
  NODE_MAJOR="$NODE_MAJOR" \
  PNPM_VERSION="$PNPM_VERSION" \
  bash -c '
    set -Eeuo pipefail
    # shellcheck disable=SC1090
    source "$NVM_DIR/nvm.sh"
    nvm install "$NODE_MAJOR"
    nvm alias default "$NODE_MAJOR"
    nvm use default
    corepack enable
    corepack prepare "pnpm@${PNPM_VERSION}" --activate
    mkdir -p "$HOME/.local/bin"
    ln -sfn "$(command -v node)" "$HOME/.local/bin/precommunity-node"
    printf "Node: %s\n" "$(node --version)"
    printf "npm:  %s\n" "$(npm --version)"
    printf "pnpm: %s\n" "$(pnpm --version)"
    printf "Runtime: %s\n" "$(readlink -f "$HOME/.local/bin/precommunity-node")"
  '

echo
echo "==> Verification"
run_root systemctl --no-pager --full status nginx fail2ban ssh | sed -n '1,80p'
run_root ufw status verbose
run_root fail2ban-client status sshd
printf '%s\n' "$effective_sshd" | grep -E '^(permitrootlogin|pubkeyauthentication|passwordauthentication|kbdinteractiveauthentication) '

if [[ -f /var/run/reboot-required ]]; then
  echo
  echo "A reboot is required to finish installing updates. Reboot only after testing a second SSH key session."
fi

echo
echo "Bootstrap complete. Keep this SSH session open and test a new one with: ssh precommunity"
