#!/usr/bin/env bash
# Sets a fresh random password for the Super Admin and prints it once. Run on the VPS inside the project folder.
set -euo pipefail
cd "$(dirname "$0")/.."
EMAIL="$(grep -E '^SEED_ADMIN_EMAIL=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
EMAIL="${EMAIL:-admin@mecgura.tech}"
PW="Mg$(openssl rand -hex 4)Aa-$(shuf -i 1000-9999 -n 1)"
echo "Setting password for $EMAIL ..."
docker compose run --rm -e SEED_ADMIN_EMAIL="$EMAIL" -e SEED_ADMIN_PASSWORD="$PW" app npx tsx prisma/seed.ts 2>&1 | grep -E "Seeded admin|Error|error" || true
docker compose restart app >/dev/null 2>&1 || true
echo
echo "===================================="
echo " Login : https://mecgura.tech/login"
echo " Email : $EMAIL"
echo " Password : $PW"
echo "===================================="
echo "Change it after login: Settings -> Change password"
