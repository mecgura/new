#!/usr/bin/env bash
# MECGURA WhatsApp — one-command API server setup for a fresh Ubuntu/Debian VPS.
#
#   ssh root@YOUR_VPS_IP
#   curl -fsSL https://raw.githubusercontent.com/mecgura/new/claude/elegant-brown-crpgxt/scripts/setup-vps.sh | bash
#
# Safe to run again: it updates the code, keeps your .env and database, and restarts the API.
set -euo pipefail

BRANCH="${BRANCH:-claude/elegant-brown-crpgxt}"
REPO="${REPO:-https://github.com/mecgura/new.git}"
APP_DIR="${APP_DIR:-/opt/mecgura}"
API_DOMAIN="${API_DOMAIN:-api.mecgura.tech}"
SITE_URL="${SITE_URL:-https://www.mecgura.tech}"
ADMIN_EMAIL="${ADMIN_EMAIL:-hello@mecgura.com}"
PORT=8080

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root (ssh root@...)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "Installing system packages (git, nginx, certbot)"
apt-get update -y -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx openssl ca-certificates >/dev/null

node_ok() { command -v node >/dev/null && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)'; }
if ! node_ok; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node $(node -v)"
command -v pm2 >/dev/null || { say "Installing pm2"; npm i -g pm2 >/dev/null; }

say "Getting the code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --no-audit --no-fund --loglevel=error

if [ ! -f .env ]; then
  say "Creating .env"
  ADMIN_PASSWORD=""
  if [ -r /dev/tty ]; then
    while [ ${#ADMIN_PASSWORD} -lt 8 ]; do
      read -r -s -p "Choose the MECGURA admin password for $ADMIN_EMAIL (min 8 chars): " ADMIN_PASSWORD </dev/tty; echo
    done
  else
    ADMIN_PASSWORD="$(openssl rand -base64 12)"
    warn "No terminal available — generated admin password: $ADMIN_PASSWORD"
  fi
  cat > .env <<EOF
NODE_ENV=production
PORT=$PORT
APP_URL=$SITE_URL
API_URL=https://$API_DOMAIN
TRUST_PROXY=2
APP_SECRET=$(openssl rand -hex 32)
DATA_DIR=$APP_DIR/data

ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
SEED_DEMO=0

WA_GRAPH_VERSION=v23.0
WA_VERIFY_TOKEN=$(openssl rand -hex 12)
META_APP_ID=
META_APP_SECRET=
META_EMBEDDED_CONFIG_ID=

ANTHROPIC_API_KEY=
AI_MODEL=claude-opus-5

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
EOF
  chmod 600 .env
else
  echo ".env already exists — keeping it"
fi
mkdir -p "$APP_DIR/data"

say "Starting the API with pm2"
cat > ecosystem.config.cjs <<EOF
const fs = require('fs')
const env = Object.fromEntries(fs.readFileSync('$APP_DIR/.env', 'utf8').split('\\n')
  .filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
module.exports = { apps: [{ name: 'mecgura-api', cwd: '$APP_DIR', script: 'server/src/index.ts', interpreter: 'node',
  interpreter_args: '--import tsx --no-warnings', env, max_memory_restart: '600M' }] }
EOF
pm2 delete mecgura-api >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs >/dev/null
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 1; done
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then echo "API is running on port $PORT"; else
  warn "API did not start. Logs:"; pm2 logs mecgura-api --lines 40 --nostream; exit 1; fi

say "Configuring nginx for $API_DOMAIN"
cat > /etc/nginx/sites-available/mecgura-api <<EOF
server {
  listen 80;
  server_name $API_DOMAIN;
  client_max_body_size 20m;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
EOF
ln -sf /etc/nginx/sites-available/mecgura-api /etc/nginx/sites-enabled/mecgura-api
nginx -t -q && systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null || true
fi

say "SSL certificate"
SERVER_IP="$(curl -fsS -4 https://api.ipify.org || hostname -I | awk '{print $1}')"
DNS_IP="$(getent ahostsv4 "$API_DOMAIN" | awk '{print $1; exit}' || true)"
if [ "$DNS_IP" = "$SERVER_IP" ]; then
  certbot --nginx -d "$API_DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect -q && echo "HTTPS enabled for $API_DOMAIN"
else
  warn "$API_DOMAIN points to ${DNS_IP:-nothing}, not this server ($SERVER_IP)."
  warn "Add a DNS A record:  api  →  $SERVER_IP   then run this script again to get HTTPS."
fi

say "Done"
cat <<EOF
  API health (local):   curl http://127.0.0.1:$PORT/health
  API public URL:       https://$API_DOMAIN/health
  Dashboard:            $SITE_URL/login   (email: $ADMIN_EMAIL)
  Settings file:        $APP_DIR/.env     (add META_*, ANTHROPIC_API_KEY, RAZORPAY_* then: cd $APP_DIR && pm2 restart ecosystem.config.cjs --update-env)
  Logs:                 pm2 logs mecgura-api
  Update later:         run this same command again
EOF
