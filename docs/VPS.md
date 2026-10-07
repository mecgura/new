# Deploying on a VPS (Hostinger / any Ubuntu server) with Docker

You need: an Ubuntu 22.04/24.04 VPS, a domain (or subdomain) whose **A record points to the VPS IP**, root/sudo access.

## 1. One-time server setup
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx git
sudo systemctl enable --now docker
```
> If the VPS already runs nginx for another site, keep it — the platform only listens on `127.0.0.1:3100` and gets its own nginx `server` block (step 4). Nothing else is touched.

## 2. Get the code
```bash
git clone https://github.com/mecgura/new.git mecgura-platform && cd mecgura-platform
git checkout <branch>        # the branch that holds the platform (e.g. claude/compassionate-newton-fhwfhv)
cp deploy/.env.vps.example .env
nano .env
```
Fill `.env` (generate secrets with `openssl rand -base64 32`):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://your-domain.example` (no trailing slash) |
| `POSTGRES_PASSWORD` | a long random password |
| `AUTH_SECRET`, `WHATSAPP_ENCRYPTION_KEY` | `openssl rand -base64 32` each |
| `CRON_SECRET` | `openssl rand -hex 24` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | your admin login |

## 3. Start
```bash
docker compose up -d --build
docker compose logs -f app      # wait for "Ready"; Ctrl+C to leave the logs
curl http://127.0.0.1:3100/api/health     # → {"status":"ok",...}
```
The container applies the database schema and creates the admin + plans on every start. Prisma **refuses destructive schema changes**, so data is never dropped silently.

## 4. HTTPS in front
```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/mecgura-platform
sudo nano /etc/nginx/sites-available/mecgura-platform      # replace your-domain.example
sudo ln -s /etc/nginx/sites-available/mecgura-platform /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.example
```
Open `https://your-domain.example/login`.

## Changing the admin email / password
* **Easiest (password):** sign in → Settings → Change password.
* **Reset email or password from the server:**
  ```bash
  nano .env          # edit SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
  docker compose up -d --force-recreate app
  ```
  Startup re-runs the seed: with `SEED_ADMIN_PASSWORD` set it (re)sets that account's password. A **new** `SEED_ADMIN_EMAIL` creates a second Super Admin; remove the old one in Admin → Users. After the first login, delete `SEED_ADMIN_PASSWORD` from `.env` so restarts never reset it.

## Updating later
```bash
git pull && docker compose up -d --build
```

## Backups
```bash
docker compose exec db pg_dump -U mecgura mecgura | gzip > backup-$(date +%F).sql.gz
```
Run it daily from cron and copy the file off the server.

## Scheduler
`next start` runs the campaign/automation scheduler in-process, so no extra cron is needed on a VPS.

## Webhooks
Meta → `https://your-domain.example/api/webhooks/meta`, Razorpay → `https://your-domain.example/api/webhooks/payments/razorpay`.
