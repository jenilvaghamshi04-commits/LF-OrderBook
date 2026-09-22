#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi
sudo -u lfbook git -C /opt/lf-orderbook fetch --prune origin main
sudo -u lfbook git -C /opt/lf-orderbook merge --ff-only origin/main
node --check /opt/lf-orderbook/server.js
node --check /opt/lf-orderbook/public/app.js
node --check /opt/lf-orderbook/public/intelligence.js
systemctl restart lf-orderbook
curl --fail --silent --show-error --retry 4 --retry-delay 2 --max-time 10 http://127.0.0.1:3000/ -o /dev/null
echo "LF OrderBook updated and running."
