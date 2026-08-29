#!/usr/bin/env bash

set -Eeuo pipefail
umask 027

readonly OLD_PORT=22
readonly NEW_PORT=22222
readonly SOCKET_DROP_IN_DIR=/etc/systemd/system/ssh.socket.d
readonly SOCKET_DROP_IN="${SOCKET_DROP_IN_DIR}/10-precommunity-listen.conf"
readonly SSH_PORT_DROP_IN=/etc/ssh/sshd_config.d/00-precommunity-port.conf
readonly FAIL2BAN_JAIL=/etc/fail2ban/jail.d/precommunity.local

if [[ "$(id -u)" -eq 0 ]]; then
  SUDO=()
else
  sudo -v
  SUDO=(sudo)
fi

run_root() {
  "${SUDO[@]}" "$@"
}

write_socket_ports() {
  local first_port="$1"
  local second_port="${2:-}"

  run_root mkdir -p "$SOCKET_DROP_IN_DIR"
  {
    printf '%s\n' '[Socket]' 'ListenStream='
    printf 'ListenStream=0.0.0.0:%s\n' "$first_port"
    printf 'ListenStream=[::]:%s\n' "$first_port"
    if [[ -n "$second_port" ]]; then
      printf 'ListenStream=0.0.0.0:%s\n' "$second_port"
      printf 'ListenStream=[::]:%s\n' "$second_port"
    fi
  } | run_root tee "$SOCKET_DROP_IN" >/dev/null
  run_root chmod 0644 "$SOCKET_DROP_IN"
}

port_is_listening() {
  local port="$1"
  run_root ss -H -lnt | awk '{ print $4 }' | grep -Eq ":${port}$"
}

stage() {
  echo "==> Allowing the new port before changing SSH"
  run_root ufw limit "${NEW_PORT}/tcp" comment 'SSH rate limit'

  echo "==> Temporarily listening on ports ${OLD_PORT} and ${NEW_PORT}"
  write_socket_ports "$OLD_PORT" "$NEW_PORT"
  run_root systemctl daemon-reload
  run_root systemctl restart ssh.socket

  port_is_listening "$OLD_PORT"
  port_is_listening "$NEW_PORT"
  run_root ss -lntp | grep -E ":(${OLD_PORT}|${NEW_PORT})[[:space:]]"
  echo "Staging complete. Test a separate connection on port ${NEW_PORT}."
}

finalize() {
  local connected_port
  connected_port="$(awk '{ print $4 }' <<<"${SSH_CONNECTION:-}")"
  if [[ "$connected_port" != "$NEW_PORT" ]]; then
    echo "Finalize must be run from an SSH session connected to port ${NEW_PORT}." >&2
    exit 1
  fi
  if ! port_is_listening "$NEW_PORT"; then
    echo "Port ${NEW_PORT} is not listening; refusing to close ${OLD_PORT}." >&2
    exit 1
  fi

  echo "==> Making port ${NEW_PORT} canonical in OpenSSH and systemd"
  printf 'Port %s\n' "$NEW_PORT" | run_root tee "$SSH_PORT_DROP_IN" >/dev/null
  run_root chmod 0644 "$SSH_PORT_DROP_IN"
  run_root sshd -t
  write_socket_ports "$NEW_PORT"

  if run_root test -f "$FAIL2BAN_JAIL"; then
    run_root sed -Ei "s/^port[[:space:]]*=.*/port = ${NEW_PORT}/" "$FAIL2BAN_JAIL"
    run_root fail2ban-client -t
  fi

  run_root systemctl daemon-reload
  run_root systemctl restart ssh.socket
  run_root systemctl restart fail2ban
  port_is_listening "$NEW_PORT"

  echo "==> Closing port ${OLD_PORT} in UFW"
  run_root ufw --force delete limit "${OLD_PORT}/tcp"

  if port_is_listening "$OLD_PORT"; then
    echo "Port ${OLD_PORT} still listens; refusing to report completion." >&2
    exit 1
  fi
  run_root ufw status verbose
  run_root fail2ban-client status sshd
  echo "SSH now listens only on port ${NEW_PORT}."
}

rollback() {
  echo "==> Restoring SSH on port ${OLD_PORT}"
  run_root ufw limit "${OLD_PORT}/tcp" comment 'SSH rate limit'
  write_socket_ports "$OLD_PORT"
  run_root rm -f "$SSH_PORT_DROP_IN"
  if run_root test -f "$FAIL2BAN_JAIL"; then
    run_root sed -Ei "s/^port[[:space:]]*=.*/port = ${OLD_PORT}/" "$FAIL2BAN_JAIL"
  fi
  run_root sshd -t
  run_root systemctl daemon-reload
  run_root systemctl restart ssh.socket
  run_root systemctl restart fail2ban
  port_is_listening "$OLD_PORT"
  echo "Rollback complete. SSH listens on port ${OLD_PORT}."
}

case "${1:-}" in
  stage) stage ;;
  finalize) finalize ;;
  rollback) rollback ;;
  *)
    echo "Usage: $0 {stage|finalize|rollback}" >&2
    exit 2
    ;;
esac
