# MECGURA WhatsApp

WhatsApp Business API platform by **MECGURA** — `https://www.mecgura.tech`

Shared team inbox · bulk campaigns · message templates · keyword chatbot · visual flow builder · follow-up sequences ·
AI assistant · CRM & leads pipeline · catalogue, orders & Razorpay payment links · analytics · multiple numbers ·
team roles & permissions · REST API, API keys & signed webhooks · plans, usage limits & subscriptions ·
multi-tenant workspaces · MECGURA super-admin console for client management.

Contact: hello@mecgura.com · +91 78377 22567 · mecgura.tech

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vite, React 19, TypeScript, Tailwind CSS v4, React Router, lucide icons |
| Backend | Node.js 22.5+, Express 5, TypeScript (run with `tsx`), Zod validation |
| Database | SQLite (built-in `node:sqlite`, WAL mode) — one file in `DATA_DIR` |
| WhatsApp | Official Meta Cloud API (Graph API), Embedded Signup, webhooks with signature check |
| AI | Anthropic Claude via `@anthropic-ai/sdk` |
| Payments | Razorpay (client payment links + MECGURA subscription checkout) |
| Realtime | Server-Sent Events for inbox, statuses and notifications |

Background worker (in-process, every 4s): scheduled/running campaigns (throttled batches), flow delays,
follow-up sequences, webhook deliveries with retries. Hourly: trial/plan expiry, renewal reminders and a
daily database backup to `DATA_DIR/backups` (last 7 kept; admins can also trigger one via `POST /api/admin/backup`).

## Plans & expiry

- New workspaces get a 14-day trial of Growth. 3 days before a trial or plan ends, owners get a reminder.
- When a trial ends the workspace becomes `expired`; paid plans go `past_due` at period end and `expired` after a
  3-day grace period. Expired workspaces keep **receiving** messages but cannot **send** (inbox, bots, campaigns,
  API) until renewed. Running campaigns pause and resume from where they stopped.
- By default clients never see plans or billing: MECGURA sets each client's plan and records UPI/bank payments in
  **Admin → Clients**, and clients are told to contact MECGURA to renew or upgrade. Set `CLIENT_BILLING=visible`
  to show clients the Plan & Billing page and let them pay online (Razorpay).

## Security

Passwords hashed with scrypt; WhatsApp and integration tokens encrypted with AES-256-GCM; JWT sessions;
role-based permissions checked on every route; every query scoped to the workspace; Meta webhook signature
check (`META_APP_SECRET`); Razorpay webhook signature check; signed outgoing webhooks; login lockout after
10 failed attempts in 15 minutes. Admins can reset a client's password from **Admin → Clients**.

## Run locally

```bash
npm install
cp .env.example .env            # fill ADMIN_PASSWORD at least
set -a; source .env; set +a
SEED_DEMO=1 npm run dev:all      # API on :8080 + dashboard on :5173, both auto-reload
npm test                         # end-to-end API tests on a temporary database
```

Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Every workspace can add a **sandbox number** and use the
**inbox simulator** to test bots, flows, AI and campaigns without a Meta account.

## Deploy: website on Vercel, API on a VPS

```
www.mecgura.tech / mecgura.tech  →  Vercel (landing page + dashboard, static)
      /api/*  /webhooks/*  /uploads/*  →  rewritten by vercel.json to  →  https://api.mecgura.tech
api.mecgura.tech  →  Hostinger VPS (Node API + SQLite + background worker)
```

The API needs a server that stays on (database file, background worker for campaigns/flows/follow-ups,
live inbox, uploads), so it runs on a VPS; Vercel serves the frontend and proxies API calls, so the browser
only ever talks to `www.mecgura.tech`.

### 1. DNS
Add an **A record** `api` → your VPS IP (where the `mecgura.tech` DNS is managed). `www` and the apex stay on Vercel.

### 2. VPS (Ubuntu, as root)

One command (installs Node 22, nginx, pm2, creates `.env` with a random `APP_SECRET`, asks for the admin
password, starts the API, configures nginx and gets an SSL certificate once DNS points to the server):

```bash
ssh root@YOUR_VPS_IP
curl -fsSL https://raw.githubusercontent.com/mecgura/new/claude/elegant-brown-crpgxt/scripts/setup-vps.sh | bash
```

Run the same command again to update. Manual steps, if you prefer:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs nginx git
npm i -g pm2
git clone https://github.com/mecgura/new.git /opt/mecgura && cd /opt/mecgura
npm ci && cp .env.example .env && nano .env      # APP_SECRET, ADMIN_PASSWORD, META_*, ANTHROPIC_API_KEY, RAZORPAY_*
pm2 start "npm start" --name mecgura-api --update-env && pm2 save && pm2 startup
```

nginx `/etc/nginx/sites-available/mecgura-api` (link it into `sites-enabled`, then `certbot --nginx -d api.mecgura.tech`):

```nginx
server {
  server_name api.mecgura.tech;
  client_max_body_size 20m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;            # live inbox (SSE)
    proxy_read_timeout 1h;
  }
}
```

Update later with `cd /opt/mecgura && git pull && npm ci && pm2 restart mecgura-api`.
Back up `DATA_DIR` (database + uploads); a daily copy is also kept in `DATA_DIR/backups`.

### 3. Vercel
The Vercel project uses `vercel.json` (`npm run build:web` → `dist`). That build reads `.env.vercel`, so the dashboard calls
`https://api.mecgura.tech` directly (the API allows the site origins via CORS; override with `CORS_ORIGINS`). Domains:
`www.mecgura.tech` and `mecgura.tech`.

Docker alternative for the API: `docker build -t mecgura-whatsapp . && docker run -d -p 8080:8080 -v mecgura-data:/data --env-file .env mecgura-whatsapp`

## Going live with Meta

1. Create a Meta app (type Business) → add **WhatsApp** product. Become a Tech Provider for Embedded Signup.
2. Webhook callback: `https://api.mecgura.tech/webhooks/whatsapp`, verify token = `WA_VERIFY_TOKEN`.
   Subscribe to `messages` and `message_template_status_update`. Set `META_APP_SECRET` so payloads are verified.
3. Embedded Signup: create a Facebook Login for Business configuration → put its ID in `META_EMBEDDED_CONFIG_ID`.
   Clients then click **Connect number** and finish onboarding in the Meta popup.
   Without it, clients can connect manually with Phone number ID + WABA ID + a permanent System User token.
4. Razorpay (clients paying MECGURA): Razorpay Dashboard → Account & Settings → API Keys → put `RAZORPAY_KEY_ID` and
   `RAZORPAY_KEY_SECRET` in the server `.env`. Then Razorpay → Webhooks → add
   `https://api.mecgura.tech/webhooks/razorpay-billing`, event **payment_link.paid**, with a secret you choose →
   put it in `RAZORPAY_WEBHOOK_SECRET`, and `pm2 restart mecgura-api --update-env`.
   In **Admin → Clients → (client) → Send payment link** pick the plan, send the link on WhatsApp; the plan activates
   automatically when paid (early renewals extend the current period). UPI/bank transfers can still be recorded manually.
   Each client connects their own Razorpay in **Settings → Integrations** to collect payments from customers.

## Project layout

```
server/src/
  index.ts            Express app, static hosting, worker start
  db.ts               SQLite schema + helpers (all tables are workspace-scoped)
  lib/                auth (JWT, workspace, API keys), permissions, security (scrypt, AES-GCM, HMAC), SSE
  services/           whatsapp (Graph API), messaging, inbound webhook, automation engine (rules, flows,
                      sequences, AI pipeline), campaigns, plans & usage limits, outgoing webhooks, razorpay, ai
  routes/             auth, public, workspace, numbers, inbox, contacts, templates, campaigns, automation,
                      commerce, team/developers, billing, analytics, admin, api_v1, webhooks
src/
  pages/site          landing, pricing, contact, auth, API docs, terms, privacy
  pages/app           dashboard + all product modules
  pages/admin         MECGURA super-admin console
  components          UI kit, app shell, charts, WhatsApp previews, reply editor
public/brand/         put the official MECGURA logo here (mecgura-logo.svg or .png)
```

## Email

- **MECGURA → clients** (welcome "set password" link, bills with Razorpay link, receipts, team invites, password
  resets, plan reminders): set `SMTP_*` in the server `.env`. Gmail: `smtp.gmail.com`, port `465`, your address and a
  Google **App Password** (Google Account → Security → 2-Step Verification → App passwords).
- **Clients → their customers**: each workspace connects its own mailbox in **Settings → Integrations → Email**, writes
  HTML templates in **Email Marketing → Templates** and sends bulk campaigns to tagged contacts. Opens are tracked
  and an unsubscribe link is added to every email automatically.

## Channels (website chat, Instagram, Messenger, custom API)

All channels land in the same Team Inbox and run the same chatbot rules, flows, AI replies and auto-assign.

- **Website chat** — Channels → Website chat → copy one line (`<script src="https://api.mecgura.tech/widget.js" data-key="wk_…" async></script>`)
  into the client's site. "Open live preview" shows it on a sample page. Optional "Continue on WhatsApp" button.
- **Instagram / Messenger** — in the same Meta app add the Messenger / Instagram products, set the webhook to
  `https://api.mecgura.tech/webhooks/meta` with the same `WA_VERIFY_TOKEN`, subscribe `messages` + `messaging_postbacks`,
  then paste the Page ID + Page access token in Channels. Replies are allowed within 24h of the customer's message.
- **Custom / API** — `POST /api/v1/inbound {"user_id","text","name"}` pushes a chat from any app; bot replies come
  back in the response and agent replies go out on the `message.sent` webhook (`channel: "api"`).

## Calendar & bookings

Calendar → Booking settings: services, hours, breaks, slot size, capacity and reminders. Add a **Book appointment**
step in the Flow Builder and customers pick a free day and time on WhatsApp (or website chat). Confirmations include
a Google Calendar link; the private ICS link syncs every booking into Google Calendar / Outlook / Apple Calendar.

## Public API

See `/docs` in the app. Example:

```bash
curl https://www.mecgura.tech/api/v1/messages -H "Authorization: Bearer mk_live_…" \
  -H "Content-Type: application/json" \
  -d '{"to":"919876543210","type":"template","template":"order_update","variables":["Aman","1024","shipped"]}'
```
