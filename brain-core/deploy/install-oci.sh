#!/usr/bin/env bash
# One-shot installer for the OCI VM 92.5.60.87 (or any Ubuntu/Debian box).
# Usage:
#   sudo bash brain-core/deploy/install-oci.sh
set -euo pipefail

WORKSPACE="${BRAIN_WORKSPACE:-/srv/global-brain}"
DATA_DIR="${BRAIN_DATA_DIR:-/var/lib/brain}"
UNIT_SRC="$(dirname "$0")/brain-core.service"
UNIT_DST="/etc/systemd/system/brain-core.service"

echo "[brain] creating service user"
id -u brain >/dev/null 2>&1 || useradd --system --home "$WORKSPACE" --shell /usr/sbin/nologin brain

echo "[brain] ensuring dirs"
install -d -o brain -g brain "$DATA_DIR"
install -d -o brain -g brain "$WORKSPACE"

echo "[brain] installing systemd unit -> $UNIT_DST"
install -m 0644 "$UNIT_SRC" "$UNIT_DST"
systemctl daemon-reload

echo "[brain] verifying node"
command -v node >/dev/null || { echo "node is required"; exit 1; }

echo "[brain] (re)starting brain-core"
systemctl enable brain-core.service
systemctl restart brain-core.service
sleep 1
systemctl --no-pager --full status brain-core.service || true

echo
echo "[brain] health check:"
curl -fsS http://127.0.0.1:7070/health || { echo "daemon did not come up"; exit 1; }
echo
echo "[brain] DONE. Point agents at BRAIN_URL=http://<vm>:7070 and/or BRAIN_NATS_URL=nats://<vm>:4222"
