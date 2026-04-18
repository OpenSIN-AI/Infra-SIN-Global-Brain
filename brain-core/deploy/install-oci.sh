#!/usr/bin/env bash
# One-shot installer for the ONE-BRAIN core daemon on Ubuntu/Debian.
# Expected on VM 92.5.60.87 but works on any modern systemd host.
#
# Usage on the VM:
#   sudo bash brain-core/deploy/install-oci.sh
#
# Or from the deploy tarball:
#   tar xzf brain-oci.tar.gz -C /tmp/brain-oci && sudo bash /tmp/brain-oci/install.sh
#
# Env overrides:
#   BRAIN_WORKSPACE       (default /srv/global-brain)
#   BRAIN_DATA_DIR        (default /var/lib/brain)
#   BRAIN_HTTP_PORT       (default 7070)
#   BRAIN_NATS_URL        (default nats://127.0.0.1:4222)
#   INSTALL_NATS          (default 1 — set to 0 to skip nats-server install)
#   SEED_AGENTS_MD        (default 1 — set to 0 to skip seeding AGENTS.md)
set -euo pipefail

WORKSPACE="${BRAIN_WORKSPACE:-/srv/global-brain}"
DATA_DIR="${BRAIN_DATA_DIR:-/var/lib/brain}"
HTTP_PORT="${BRAIN_HTTP_PORT:-7070}"
NATS_URL="${BRAIN_NATS_URL:-nats://127.0.0.1:4222}"
INSTALL_NATS="${INSTALL_NATS:-1}"
SEED_AGENTS_MD="${SEED_AGENTS_MD:-1}"

# Resolve the directory this script lives in — when invoked from a packaged
# tarball, this is /tmp/brain-oci; from a clone it's <repo>/brain-core/deploy.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/brain-core.service" ] && [ -f "$SCRIPT_DIR/install.sh" ]; then
  # Packaged tarball layout — service unit sits next to install.sh
  SRC_ROOT="$SCRIPT_DIR"
  UNIT_SRC="$SCRIPT_DIR/brain-core.service"
else
  # Repo layout — walk up to repo root
  SRC_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  UNIT_SRC="$SCRIPT_DIR/brain-core.service"
fi
UNIT_DST="/etc/systemd/system/brain-core.service"

log() { printf "\033[1;34m[brain]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[brain] %s\033[0m\n" "$*" >&2; }

if [ "$(id -u)" -ne 0 ]; then
  err "must run as root (sudo bash $0)"
  exit 1
fi

# --- Node -----------------------------------------------------------------
if ! command -v node >/dev/null; then
  log "installing Node.js 22 LTS via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
log "node $(node -v)"

# --- NATS JetStream -------------------------------------------------------
if [ "$INSTALL_NATS" = "1" ] && ! command -v nats-server >/dev/null; then
  log "installing nats-server"
  NATS_VERSION="v2.10.22"
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64) NATS_ARCH=linux-amd64 ;;
    aarch64) NATS_ARCH=linux-arm64 ;;
    *) err "unknown arch $ARCH"; exit 1 ;;
  esac
  TMPDIR=$(mktemp -d)
  curl -fsSL "https://github.com/nats-io/nats-server/releases/download/${NATS_VERSION}/nats-server-${NATS_VERSION}-${NATS_ARCH}.tar.gz" \
    | tar xz -C "$TMPDIR"
  install -m 0755 "$TMPDIR/nats-server-${NATS_VERSION}-${NATS_ARCH}/nats-server" /usr/local/bin/nats-server
  rm -rf "$TMPDIR"

  log "installing nats-server systemd unit"
  cat >/etc/systemd/system/nats-server.service <<'UNIT'
[Unit]
Description=NATS JetStream server
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/local/bin/nats-server -js -sd /var/lib/nats -a 127.0.0.1 -p 4222
Restart=always
RestartSec=2
LimitNOFILE=65536
User=nats
Group=nats

[Install]
WantedBy=multi-user.target
UNIT
  id -u nats >/dev/null 2>&1 || useradd --system --home /var/lib/nats --shell /usr/sbin/nologin nats
  install -d -o nats -g nats /var/lib/nats
  systemctl daemon-reload
  systemctl enable --now nats-server.service
fi

# --- service user + dirs --------------------------------------------------
log "preparing service user + directories"
id -u brain >/dev/null 2>&1 || useradd --system --home "$WORKSPACE" --shell /usr/sbin/nologin brain
install -d -o brain -g brain "$DATA_DIR"
install -d -o brain -g brain "$WORKSPACE"

# --- copy sources ---------------------------------------------------------
log "syncing sources into $WORKSPACE"
# From packaged tarball: SRC_ROOT already contains the package contents.
# From repo: SRC_ROOT is the repo root.
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'brain-data' \
  --exclude 'credentials' \
  --exclude 'brain/projects/*' \
  "$SRC_ROOT"/ "$WORKSPACE"/
chown -R brain:brain "$WORKSPACE"

# --- install node deps ----------------------------------------------------
log "installing node dependencies (production)"
pushd "$WORKSPACE" >/dev/null
sudo -u brain npm ci --omit=dev --silent || sudo -u brain npm install --omit=dev --silent
# Optional native HNSW acceleration — don't fail the install if it doesn't compile.
if [ "${INSTALL_HNSW:-1}" = "1" ]; then
  log "attempting native HNSW acceleration (optional)"
  sudo -u brain npm install --no-save hnswlib-node --silent 2>/dev/null \
    && log "HNSW native acceleration enabled" \
    || log "HNSW native unavailable — falling back to JS vector index"
fi
popd >/dev/null

# --- systemd unit ---------------------------------------------------------
log "installing systemd unit -> $UNIT_DST"
install -m 0644 "$UNIT_SRC" "$UNIT_DST"
# Inject the requested port / nats url in case they differ from defaults.
sed -i "s|BRAIN_HTTP_PORT=.*|BRAIN_HTTP_PORT=${HTTP_PORT}|" "$UNIT_DST"
sed -i "s|BRAIN_NATS_URL=.*|BRAIN_NATS_URL=${NATS_URL}|" "$UNIT_DST"
systemctl daemon-reload

# --- start daemon ---------------------------------------------------------
log "starting brain-core"
systemctl enable brain-core.service
systemctl restart brain-core.service

# --- health check ---------------------------------------------------------
sleep 2
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HTTP_PORT}/health" >/dev/null 2>&1; then
    log "daemon healthy on :${HTTP_PORT}"
    break
  fi
  if [ "$i" -eq 30 ]; then
    err "daemon did not come up — see: journalctl -u brain-core -n 80"
    exit 1
  fi
  sleep 1
done

# --- seed initial canon from AGENTS.md -----------------------------------
if [ "$SEED_AGENTS_MD" = "1" ] && [ -f "$WORKSPACE/AGENTS.md" ]; then
  log "seeding PRIORITY canon from AGENTS.md"
  sudo -u brain BRAIN_URL="http://127.0.0.1:${HTTP_PORT}" \
    node "$WORKSPACE/brain-core/seed/agents-md-seeder.js" "$WORKSPACE/AGENTS.md" \
    || err "seeder returned non-zero — check journalctl for details (install continues)"
fi

# --- final status ---------------------------------------------------------
log "stats:"
curl -fsS "http://127.0.0.1:${HTTP_PORT}/stats" | python3 -m json.tool 2>/dev/null \
  || curl -fsS "http://127.0.0.1:${HTTP_PORT}/stats"
echo
log "DONE"
log "Agents: export BRAIN_URL=http://<vm-public-ip>:${HTTP_PORT}"
[ "$INSTALL_NATS" = "1" ] && log "        export BRAIN_NATS_URL=${NATS_URL}"
log "Logs:   journalctl -u brain-core -f"
