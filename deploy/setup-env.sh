#!/usr/bin/env bash
# Creates .env for the VPS: fixed values below, random secrets generated ON THIS SERVER (never printed), admin password typed by you.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -e .env ] && { echo ".env already exists — remove it first if you want to regenerate."; exit 1; }
read -r -s -p "Choose the admin password (min 8 chars, letters+numbers): " PW; echo
read -r -s -p "Repeat it: " PW2; echo
[ "$PW" = "$PW2" ] || { echo "Passwords do not match."; exit 1; }
[ "${#PW}" -ge 8 ] || { echo "Too short."; exit 1; }
umask 077
cat > .env <<EOF
NEXT_PUBLIC_APP_URL=https://www.mecgura.tech
POSTGRES_PASSWORD=$(openssl rand -hex 24)
AUTH_SECRET=$(openssl rand -base64 32)
WHATSAPP_ENCRYPTION_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 24)
SEED_ADMIN_EMAIL=admin@mecgura.tech
SEED_ADMIN_PASSWORD=$PW
EOF
echo ".env created (permissions 600). Admin email: admin@mecgura.tech"
