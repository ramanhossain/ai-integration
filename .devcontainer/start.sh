#!/usr/bin/env bash
# Start het platform in een GitHub Codespace (op de achtergrond, poort 3001).
# - Gegevens blijven bewaard in platform/data (zolang de codespace bestaat).
# - Een eigen encryptiesleutel wordt één keer gemaakt en in platform/data/.secret bewaard.
# - Logs: tail -f /tmp/aip.log
set -euo pipefail
cd "$(dirname "$0")/../platform"
mkdir -p data
[ -s data/.secret ] || (openssl rand -base64 32 > data/.secret && chmod 600 data/.secret)
export AIP_SECRET_KEY="$(cat data/.secret)"
export PORT=3001 HOST=0.0.0.0
if [ -n "${CODESPACE_NAME:-}" ]; then
  export AIP_PUBLIC_URL="https://${CODESPACE_NAME}-3001.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
fi
pkill -f "tsx src/index.ts" 2>/dev/null || true
nohup npx tsx src/index.ts > /tmp/aip.log 2>&1 &
echo "AIP start op poort 3001 — ${AIP_PUBLIC_URL:-http://localhost:3001}/app/  (logs: /tmp/aip.log)"
