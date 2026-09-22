#!/usr/bin/env bash
# Run on an Ubuntu 24.04 Always Free VM after DNS points to its public IP.
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi
domain="${1:-}"
if [[ ! "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$ ]]; then
  echo "Usage: sudo bash deploy/oracle/install.sh monitor.example.com" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git gnupg openssl debian-keyring debian-archive-keyring apt-transport-https

# NodeSource's Ubuntu package provides Node.js 22 on both Oracle AMD and Arm VMs.
if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/lf-nodesource-setup.sh
  bash /tmp/lf-nodesource-setup.sh
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  chmod a+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  apt-get update
  apt-get install -y caddy
fi

if ! id lfbook >/dev/null 2>&1; then
  useradd --system --home-dir /opt/lf-orderbook --shell /usr/sbin/nologin lfbook
fi
if [[ ! -d /opt/lf-orderbook/.git ]]; then
  git clone --depth 1 --branch main https://github.com/jenilvaghamshi04-commits/LF-OrderBook.git /opt/lf-orderbook
fi
chown -R lfbook:lfbook /opt/lf-orderbook
node --check /opt/lf-orderbook/server.js

if [[ ! -e /etc/lf-orderbook.env ]]; then
  admin_code="$(openssl rand -hex 24)"
  cat > /etc/lf-orderbook.env <<EOF
PORT=3000
HOST=127.0.0.1
PUBLIC_BASE_URL=https://${domain}
SETTINGS_ADMIN_TOKEN=${admin_code}
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_BUY_THRESHOLD=500
TELEGRAM_SELL_THRESHOLD=300
TELEGRAM_TOTAL_THRESHOLD=1000
EOF
fi
chmod 600 /etc/lf-orderbook.env

cat > /etc/systemd/system/lf-orderbook.service <<'EOF'
[Unit]
Description=LF OrderBook monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=lfbook
Group=lfbook
WorkingDirectory=/opt/lf-orderbook
EnvironmentFile=/etc/lf-orderbook.env
ExecStart=/usr/bin/node /opt/lf-orderbook/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
${domain} {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now lf-orderbook
systemctl enable --now caddy
systemctl reload caddy
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/ -o /dev/null
echo "App started. Check HTTPS at https://${domain}/ after OCI ports 80/443 and DNS are configured."
echo "Add Telegram credentials with: sudoedit /etc/lf-orderbook.env, then sudo systemctl restart lf-orderbook"
