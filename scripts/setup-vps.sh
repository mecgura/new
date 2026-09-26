#!/usr/bin/env bash
# MECGURA WhatsApp — one-shot API server setup for an Ubuntu/Debian VPS (run as root).
#   bash <(curl -fsSL https://raw.githubusercontent.com/mecgura/new/claude/elegant-brown-crpgxt/scripts/setup-vps.sh)
# Safe to re-run: it updates the code and restarts the API, and keeps the existing .env and data.
set -euo pipefail

DOMAIN="${API_DOMAIN:-api.mecgura.tech}"
SITE_URL="${SITE_URL:-https://www.mecgura.tech}"
REPO="${REPO:-https://github.com/mecgura/new.git}"
BRANCH="${BRANCH:-claude/elegant-brown-crpgxt}"
APP_DIR=/opt/mecgura
DATA_DIR=/opt/mecgura-data
PORT=8080

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Please run as root (sudo -i)."; exit 1; }

say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ca-certificates >/dev/null

need_node=1
if command -v node >/dev/null; then
  v=$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); a>22||(a===22&&b>=5)?1:0')
  [ "$v" = "1" ] && need_node=0
fi
if [ "$need_node" = "1" ]; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
command -v pm2 >/dev/null || npm i -g pm2 >/dev/null
echo "node $(node -v), npm $(npm -v), pm2 $(pm2 -v)"

say "Fetching MECGURA WhatsApp ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q -b "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --no-audit --no-fund --loglevel=error
mkdir -p "$DATA_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  say "Creating .env"
  # ADMIN_EMAIL / ADMIN_PASSWORD can be passed as environment variables for unattended installs.
  if [ -z "${ADMIN_EMAIL:-}" ]; then read -rp "Admin email [hello@mecgura.com]: " ADMIN_EMAIL < /dev/tty || true; fi
  ADMIN_EMAIL=${ADMIN_EMAIL:-hello@mecgura.com}
  ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
  while [ "${#ADMIN_PASSWORD}" -lt 8 ]; do
    read -rsp "Choose admin password (min 8 chars): " ADMIN_PASSWORD < /dev/tty; echo
    [ "${#ADMIN_PASSWORD}" -ge 8 ] || echo "Too short, try again."
  done
  # Single-quote the password so characters like $ ` " survive `source .env`.
  Q_PASS="'$(printf '%s' "$ADMIN_PASSWORD" | sed "s/'/'\\\\''/g")'"
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=$PORT
APP_URL=$SITE_URL
API_URL=https://$DOMAIN
TRUST_PROXY=2
DATA_DIR=$DATA_DIR
APP_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$Q_PASS
SEED_DEMO=0

# ---- Meta / WhatsApp Cloud API (fill in, then: pm2 restart mecgura-api --update-env) ----
WA_GRAPH_VERSION=v23.0
WA_VERIFY_TOKEN=$(openssl rand -hex 12)
META_APP_ID=
META_APP_SECRET=
META_EMBEDDED_CONFIG_ID=

# ---- AI assistant ----
ANTHROPIC_API_KEY=
AI_MODEL=claude-opus-5

# ---- Subscription billing (MECGURA Razorpay) ----
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
EOF
  chmod 600 "$APP_DIR/.env"
else
  say "Keeping existing .env"
fi

say "Starting the API with pm2"
cat > "$APP_DIR/run.sh" <<'EOF'
#!/usr/bin/env bash
set -a; . /opt/mecgura/.env; set +a
cd /opt/mecgura && exec node --import tsx server/src/index.ts
EOF
chmod +x "$APP_DIR/run.sh"
if pm2 describe mecgura-api >/dev/null 2>&1; then pm2 restart mecgura-api --update-env >/dev/null; else pm2 start "$APP_DIR/run.sh" --name mecgura-api >/dev/null; fi
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

for i in $(seq 1 20); do curl -fs "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 1; done
if curl -fs "http://127.0.0.1:$PORT/health"; then echo; else warn "API did not start. Logs:"; pm2 logs mecgura-api --lines 40 --nostream; exit 1; fi

say "Configuring nginx for $DOMAIN"
cat > /etc/nginx/sites-available/mecgura-api <<EOF
server {
  listen 80;
  server_name $DOMAIN;
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
if ss -ltnp 2>/dev/null | grep -q ':80 ' && ! ss -ltnp 2>/dev/null | grep ':80 ' | grep -q nginx; then
  warn "Something other than nginx is using port 80:"; ss -ltnp | grep ':80 '
  warn "Stop it (e.g. systemctl disable --now apache2) and re-run this script."; exit 1
fi
if ! nginx -t -q; then warn "nginx config test failed (see above)."; exit 1; fi
if command -v systemctl >/dev/null && systemctl is-system-running >/dev/null 2>&1 || [ "$(systemctl is-system-running 2>/dev/null)" = "degraded" ]; then
  systemctl enable -q nginx && { systemctl reload nginx 2>/dev/null || systemctl restart nginx; }
else
  nginx -s reload 2>/dev/null || nginx
fi
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 'Nginx Full' >/dev/null; ufw allow OpenSSH >/dev/null; fi

say "HTTPS certificate"
MY_IP=$(curl -fs4 https://api.ipify.org || hostname -I | awk '{print $1}')
DNS_IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')
if [ "$DNS_IP" = "$MY_IP" ]; then
  EMAIL=$(grep -E '^ADMIN_EMAIL=' "$APP_DIR/.env" | cut -d= -f2)
  pkill -x certbot 2>/dev/null && sleep 2 || true   # a certbot left over from an interrupted run holds the lock
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect -q; then
    echo "HTTPS enabled for $DOMAIN"
  else
    warn "Certificate not issued yet. Check that ports 80/443 are open, then re-run this script."
  fi
else
  warn "$DOMAIN points to ${DNS_IP:-nothing}, but this server is $MY_IP."
  warn "Add DNS record:  Type A   Name api   Value $MY_IP   — wait 5 minutes, then re-run this script."
fi

say "Done"
cat <<EOF
API:        https://$DOMAIN/health
Website:    $SITE_URL  (login with the admin email/password you chose)
Webhook:    https://$DOMAIN/webhooks/whatsapp   verify token: $(grep -E '^WA_VERIFY_TOKEN=' "$APP_DIR/.env" | cut -d= -f2)
Edit keys:  nano $APP_DIR/.env   then   pm2 restart mecgura-api --update-env
Logs:       pm2 logs mecgura-api
Update:     re-run this script
EOF
