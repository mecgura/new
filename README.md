# MECGURA WhatsApp

WhatsApp Business API platform by **MECGURA** — `https://whatsapp.mecgura.tech`

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
- Renew online (Razorpay) from Plan & Billing, or record a UPI/bank payment in **Admin → Clients**.

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

## Deploy (VPS, e.g. Hostinger / DigitalOcean)

```bash
# Node 22.5+ and nginx installed
git clone <repo> mecgura-whatsapp && cd mecgura-whatsapp
npm ci && npm run build
cp .env.example .env && nano .env            # APP_SECRET, ADMIN_PASSWORD, META_*, etc.
npm i -g pm2
pm2 start "npm start" --name mecgura-whatsapp --update-env && pm2 save
```

nginx (then `certbot --nginx -d whatsapp.mecgura.tech`):

```nginx
server {
  server_name whatsapp.mecgura.tech;
  client_max_body_size 20m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;            # needed for live inbox (SSE)
    proxy_read_timeout 1h;
  }
}
```

Or Docker: `docker build -t mecgura-whatsapp . && docker run -d -p 8080:8080 -v mecgura-data:/data --env-file .env mecgura-whatsapp`

Back up `DATA_DIR` (database + uploads) daily.

## Going live with Meta

1. Create a Meta app (type Business) → add **WhatsApp** product. Become a Tech Provider for Embedded Signup.
2. Webhook callback: `https://whatsapp.mecgura.tech/webhooks/whatsapp`, verify token = `WA_VERIFY_TOKEN`.
   Subscribe to `messages` and `message_template_status_update`. Set `META_APP_SECRET` so payloads are verified.
3. Embedded Signup: create a Facebook Login for Business configuration → put its ID in `META_EMBEDDED_CONFIG_ID`.
   Clients then click **Connect number** and finish onboarding in the Meta popup.
   Without it, clients can connect manually with Phone number ID + WABA ID + a permanent System User token.
4. Razorpay: set `RAZORPAY_KEY_*` to sell plans online; otherwise record UPI/bank payments in **Admin → Clients**.
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

## Public API

See `/docs` in the app. Example:

```bash
curl https://whatsapp.mecgura.tech/api/v1/messages -H "Authorization: Bearer mk_live_…" \
  -H "Content-Type: application/json" \
  -d '{"to":"919876543210","type":"template","template":"order_update","variables":["Aman","1024","shipped"]}'
```
