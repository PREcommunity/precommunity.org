# Production logs in Axiom

One Vector agent forwards stdout/stderr from `precommunity-web.service`,
`precommunity-api.service` and `precommunity-worker.service` through journald.
No application SDK or application service changes are required. The selected
dataset is `precommunity.org`, in US East (North Virginia):
`https://us-east-1.aws.edge.axiom.co/v1/ingest/precommunity.org`.

Use the ingest-only API token for this dataset, stored as one raw line in
`/etc/precommunity/axiom.token`, owned by root with mode `0600`. Never put the
token in command arguments, repository files, terminal output or application env.

## Prepare the agent on the VPS

These are operator commands, not part of application deployment. They do not
start the collector until the separate activation step below. This configuration
was tested with Vector **0.56.0**. The confirmed VPS systemd version is **259**;
cross-boot journal recovery requires systemd older than 250 or at least 258.

For the confirmed x86_64 VPS, download the official pinned archive, verify its
published SHA256, and install only its executable. This avoids package-manager
service auto-starts. Stop on any failed command; do not use `curl | sh`.

```sh
set -eu
test "$(uname -m)" = x86_64
vector_stage=$(mktemp -d)
vector_archive="$vector_stage/vector.tar.gz"
curl --fail --location --proto '=https' --tlsv1.2 \
  https://github.com/vectordotdev/vector/releases/download/v0.56.0/vector-0.56.0-x86_64-unknown-linux-gnu.tar.gz \
  --output "$vector_archive"
printf '%s  %s\n' \
  7139f412c9d1c5fdff4b59d566c6dbad8a2ef8bb5aa3db82c81e78e4cd919019 \
  "$vector_archive" | sha256sum --check -
mkdir "$vector_stage/extracted"
tar -xzf "$vector_archive" -C "$vector_stage/extracted" --strip-components=2
sudo install -d -o root -g root -m 0755 /opt/precommunity-vector/0.56.0/bin
sudo install -o root -g root -m 0755 "$vector_stage/extracted/bin/vector" \
  /opt/precommunity-vector/0.56.0/bin/vector
/opt/precommunity-vector/0.56.0/bin/vector --version
```

Create the dedicated service account and install the reviewed config/tests/unit
from the repository checkout. Keep its config outside `/etc/precommunity`: that
directory also contains application signing credentials and must remain
inaccessible to the collector. PID 1 can read the root-only EnvironmentFile.

```sh
getent passwd precommunity-vector >/dev/null || \
  sudo useradd --system --user-group --home-dir /nonexistent \
    --shell /usr/sbin/nologin precommunity-vector
sudo install -d -o root -g precommunity-vector -m 0750 /etc/precommunity-vector
sudo install -d -o precommunity-vector -g precommunity-vector -m 0750 \
  /var/lib/precommunity-vector
sudo install -o root -g precommunity-vector -m 0640 \
  ops/vector/precommunity-axiom.toml /etc/precommunity-vector/vector.toml
sudo install -o root -g precommunity-vector -m 0640 \
  ops/vector/precommunity-axiom.tests.toml /etc/precommunity-vector/vector.tests.toml
sudo install -o root -g root -m 0644 \
  ops/systemd/precommunity-vector.service /etc/systemd/system/precommunity-vector.service
```

Convert the raw token to a root-only systemd EnvironmentFile internally. The
existing Node runtime reads the token from disk; it never reaches stdout or argv.
Repeat this step after rotating the token, then restart only the collector.

```sh
sudo /home/ubuntu/.local/bin/precommunity-node --input-type=module <<'JS'
import { constants, readFileSync, openSync, fchmodSync, fchownSync, writeSync, closeSync } from 'node:fs';
const token = readFileSync('/etc/precommunity/axiom.token', 'utf8').trim();
if (!/^[\x21-\x7e]+$/.test(token)) throw new Error('Axiom token must be one nonempty ASCII line.');
const fd = openSync('/etc/precommunity/axiom.env', constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
try {
  fchmodSync(fd, 0o600);
  fchownSync(fd, 0, 0);
  writeSync(fd, `AXIOM_TOKEN=${JSON.stringify(token)}\n`);
} finally {
  closeSync(fd);
}
JS
```

## Validate before activation

These commands use a synthetic token and send no logs. Unit tests exercise the
actual remap code, including worker field selection, credential/transaction
masking, environment dumps, unrelated units and oversized messages. Sources and
sinks are not run by `vector test`.

```sh
sudo -u precommunity-vector env AXIOM_TOKEN=configuration-test-only \
  /opt/precommunity-vector/0.56.0/bin/vector validate --no-environment \
  /etc/precommunity-vector/vector.toml
sudo -u precommunity-vector env AXIOM_TOKEN=configuration-test-only \
  /opt/precommunity-vector/0.56.0/bin/vector test \
  /etc/precommunity-vector/vector.toml /etc/precommunity-vector/vector.tests.toml
sudo systemd-analyze verify /etc/systemd/system/precommunity-vector.service
```

## Activate and check

After validation, the operator starts only the new collector:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now precommunity-vector.service
sudo systemctl is-active precommunity-vector.service
```

View the dataset in Axiom and filter `service` by `precommunity-web`,
`precommunity-api` or `precommunity-worker`. Confirm a new normal event from each
application. Do not dump application environment, raw error objects or signing
data as a smoke test. Collector diagnostics remain local in
`journalctl -u precommunity-vector.service`; its own logs are not forwarded.

The first start begins at the current journal position (`since_now=true`). Later
starts use the persisted cursor, including earlier boots. The 512 MiB disk buffer
retries delivery during outages; acknowledgements prevent the cursor advancing
before delivery. Delivery can duplicate records. Keep `/var/lib/precommunity-vector`
across releases/restarts. A sufficiently long outage can exhaust journal retention
(the VPS journal is bounded to 500 MB), so unlimited recovery is not promised.

Worker JSON is replaced with allowlisted scalar diagnostics; the original JSON
is discarded. All retained strings are masked for URLs, Bearer credentials,
key/password fields and long hexadecimal signing bytes. Messages over 32 KiB,
recognized environment dumps and transform failures are dropped. Redaction is a
second boundary; applications must still avoid logging secrets in the first place.

Official references: [Axiom Vector integration](https://axiom.co/docs/send-data/vector),
[journal source](https://vector.dev/docs/reference/configuration/sources/journald/),
[Axiom sink](https://vector.dev/docs/reference/configuration/sinks/axiom/),
[configuration tests](https://vector.dev/docs/reference/configuration/unit-tests/),
[pinned release and archive checksums](https://github.com/vectordotdev/vector/releases/expanded_assets/v0.56.0).
