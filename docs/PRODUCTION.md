# MECGURA Platform — production guide

Standalone application: the client workspace (WhatsApp automation platform) and the Super Admin console, with its own repository, Vercel project, domain and database. The marketing website is a separate project.

* 49 database models · 154 API route handlers · 0 placeholder screens
* Everything works **without any third-party credentials** (demo mode, clearly labelled). Real Meta / Razorpay / Claude paths switch on when their variables are set.

---

## 1. Architecture

```
Browser ── proxy.ts (JWT cookie gate for app/admin pages;  "/" → /dashboard)
   │
   ├─ (auth)   login · forgot/reset password
   ├─ (app)    client workspace  ── one AppShell: sidebar, topbar, number switcher, notifications
   └─ admin    Super Admin console ── same shell, ADMIN_NAV
        │
        ▼
 src/app/api/**/route.ts   ← handle() → ApiError → one error shape { error, code, details? }
        │   orgRoute(req, params, permission)   tenant + role check on EVERY /api/organizations/[orgId]/** call
        │   requireSuperAdmin(req)              every /api/admin/** call
        │   apiHandle(scope, fn)                /api/v1/** (API key, scope, rate limit, metadata-only log)
        ▼
 src/services/*   business logic (inbox, templates, campaigns, automations, flows, ai, api, webhooks, billing, analytics, quality, whatsapp)
        ▼
 src/providers/*  the only code that talks to third parties:  meta (WhatsApp Cloud API) · anthropic (AI agent) · payments (gateway registry → razorpay)
        ▼
 Prisma 7 → SQLite (dev) / PostgreSQL (prod)      schema.prisma ≡ schema.postgres.prisma below the models
```

* **Multi-tenant:** every tenant row carries `organizationId`; every query is scoped by `(id, organizationId)`. `orgRoute` resolves the membership server-side, never from the client. The security sweep (below) fires every route with another tenant's ids.
* **Background work:** `src/instrumentation.ts` runs one in-process scheduler per `next start` instance (campaigns, automation timers, webhook retries, billing cycle). On serverless call `GET /api/cron/campaigns` every minute with `Authorization: Bearer $CRON_SECRET`.
* **Real time:** server-sent events (`src/lib/realtime`) for the inbox.
* **Plans are data**, never code: limits (`-1` = unlimited) and feature flags are read on every request (`src/services/billing/entitlements.ts`).
* **Payments** go through a gateway abstraction (`src/providers/payments`). An invoice becomes *paid* only through a verified gateway webhook/return, or an admin recording real money with a reference. Nothing is ever faked.

## 2. Database

55 models (see `prisma/schema.prisma`), grouped:

| Area | Models |
|---|---|
| Identity & tenancy | User, PasswordResetToken, Organization, OrganizationMember, OrganizationService, OrganizationSettings |
| WhatsApp | WhatsAppBusinessAccount, PhoneNumber, WhatsAppAccount, WhatsAppConnection, WebhookConfiguration, WebhookEvent |
| Inbox & CRM | Contact, Tag, ContactTag, ContactNote, ConsentRecord, Conversation, ConversationAssignment, Message, MessageAttachment, Appointment |
| Templates & campaigns | MessageTemplate, Segment, Campaign, CampaignRecipient |
| Automation | Automation, AutomationVersion, AutomationExecution, AutomationExecutionStep |
| Flows & AI | Flow, FlowSubmission, AiAgent, AiDocument, AiInteraction |
| API & webhooks | ApiKey, ApiRequestLog, WebhookEndpoint, WebhookDelivery |
| Billing | Plan, Subscription, Invoice, InvoiceSequence, Payment, PaymentEvent, UsageCounter |
| Platform | AuditLog, Notification, SiteSetting (key/value admin settings) |

Migrations live in `prisma/migrations` (SQLite). **Production (PostgreSQL)** uses `prisma/schema.postgres.prisma` — keep it identical to `schema.prisma` below the `model` lines.

## 3. Routes

| Surface | Path | Who |
|---|---|---|
| Auth | `/login`, `/forgot-password`, `/reset-password` | everyone |
| Workspace | `/dashboard`, `/dashboard/whatsapp`, `/whatsapp/{accounts,connect,quality}`, `/inbox`, `/contacts[/id]`, `/templates[/new,/id]`, `/campaigns[/id]`, `/automations[/id]`, `/flows[/id]`, `/ai`, `/analytics`, `/api`, `/webhooks`, `/billing[/invoices/id]`, `/team`, `/settings[/organization,/security]` | signed-in members (role-gated) |
| Super Admin | `/admin`, `/admin/{clients[/new,/id],users,whatsapp,billing,usage,analytics,audit-logs,settings}` | `SUPER_ADMIN` |
| Workspace API | `/api/organizations/[orgId]/**` | session + membership + permission |
| Admin API | `/api/admin/**` | `SUPER_ADMIN` |
| Public API | `/api/v1/{me,numbers,templates,contacts,conversations,messages}` | API key + scope |
| Inbound (no session) | `/api/webhooks/meta` (signed), `/api/webhooks/payments/[gateway]` (signed), `/api/automations/hooks/[aid]` (secret), `/api/cron/campaigns` (CRON_SECRET), `/api/auth/*`, `/api/health` | the only routes reachable without a session — a test fails if another one appears |

## 4. Authentication & authorization

* Auth.js credentials, bcrypt hashes, JWT cookie. `src/proxy.ts` is only the first gate; every page, layout and API route re-checks the user, role and tenant against the database.
* Platform role: `SUPER_ADMIN` or `USER`. Workspace roles: `CLIENT_OWNER`, `MANAGER`, `AGENT` (permission table in `src/lib/authz.ts`).
* Login, password reset and every API-key request are rate limited; failed API-key attempts are throttled per IP.
* Passwords: min-strength validation, reset tokens hashed + single use + expiring; reset email only when `RESEND_API_KEY` is set (never faked).
* Secrets at rest: WhatsApp tokens and webhook signing secrets are AES-256-GCM encrypted (`WHATSAPP_ENCRYPTION_KEY`); API keys are stored as hashes and shown once; APIs return `••••last4` only.
* Outgoing webhooks: HMAC-SHA256 signed with timestamp, SSRF-guarded (public HTTPS hosts only, DNS-checked), retried with backoff, payloads purged after delivery.
* Uploads: size + type allow-lists (inbox media, CSV import 2 MB, AI documents 200 KB text, template header samples); nothing is executed or served inline.
* Headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production; every `/api` response is `no-store`.

## 5. Integrations

| Integration | Needs | Without it |
|---|---|---|
| Meta WhatsApp Cloud API (Embedded Signup, webhooks, templates, Flows) | `META_*`, `WHATSAPP_ENCRYPTION_KEY` | demo numbers, demo inbound/status simulators, templates "approved" by a demo reviewer, Flows published "demo — not on Meta" |
| Claude (AI agent) | `ANTHROPIC_API_KEY` | rule-based demo agent, every reply labelled **Demo**; "live" mode is refused with 409 |
| Razorpay (subscription invoices) | key id in Admin → Settings, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | invoices stay unpaid until an admin records a real payment with a reference |
| Email (Resend) | `RESEND_API_KEY`, `EMAIL_FROM` | reset emails printed to the log in dev, disabled in production |

## 6. Environment variables (names only — see `.env.example`)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **yes** | `file:./dev.db` or `postgresql://…` |
| `PRISMA_SCHEMA` | prod | `prisma/schema.postgres.prisma` |
| `AUTH_SECRET` | **yes** | Auth.js signing key (`openssl rand -base64 32`) |
| `WHATSAPP_ENCRYPTION_KEY` | **yes in production** | 32-byte base64 key for stored credentials (`openssl rand -base64 32`) |
| `NEXT_PUBLIC_APP_URL` | **yes** | this app's public https URL (webhook callbacks, reset links) |
| `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_SUPPORT_WHATSAPP` | optional | support contact in the Help menu |
| `CRON_SECRET` | serverless | protects `/api/cron/campaigns` |
| `CAMPAIGN_SCHEDULER` | optional | `off` disables the in-process scheduler |
| `META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION` | WhatsApp live | Meta app |
| `WHATSAPP_DEMO_MODE` | optional | `on` / `off` |
| `ANTHROPIC_API_KEY` | AI live | Claude |
| `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | payments live | Razorpay |
| `RESEND_API_KEY`, `EMAIL_FROM` | email | password reset |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD` | seeding only | first admin / QA tenants |

Only `NEXT_PUBLIC_*` variables reach the browser (baked in at build time). `.env` files are git-ignored; `.env.example` holds names only.

## 7. Remaining configuration (needs your accounts — cannot be done in code)

1. **Production database** (PostgreSQL) + `DATABASE_URL`, apply the schema, run the seed.
2. **Meta**: create the Meta app, enable WhatsApp + Embedded Signup, set the webhook callback to `https://<domain>/api/webhooks/meta` with `META_WEBHOOK_VERIFY_TOKEN`, complete business verification and app review for `whatsapp_business_management` / `whatsapp_business_messaging`. Until then everything runs in demo mode.
3. **Razorpay**: key id (Admin → Settings), `RAZORPAY_KEY_SECRET`, webhook `https://<domain>/api/webhooks/payments/razorpay` (events `payment.captured`, `payment.failed`) + `RAZORPAY_WEBHOOK_SECRET`.
4. **Anthropic key** for the live AI agent (optional).
5. **Resend** domain + key for password-reset email.
6. **Business details for invoices** in Admin → Billing settings (legal name, address, GST id, tax %, grace days). The tax default is 0 %.
7. **Plans**: review prices/limits in Admin → Billing & Plans (seeded: Starter, Growth, Pro, Enterprise).
8. **Billing mode** per client (`complimentary` is the default — contracted clients are not auto-invoiced; switch a client to `invoiced` to bill).
9. DNS, TLS, and (recommended) a CDN / WAF in front.

## 8. Known limitations (honest list)

* **Rate limiter is in-memory per instance.** Behind several instances, put a shared limiter (Redis / the platform's WAF) in front. Single-instance and self-hosted setups are fully covered.
* **No Content-Security-Policy yet** (all other security headers are set). Adding a nonce-based CSP is the next hardening step.
* Real Meta / Razorpay / Claude network paths are tested with mocks and signatures; they have not been exercised against live accounts from this repo.
* Contact search uses SQL `contains` (fast to ~100k contacts; add a trigram/GIN index on PostgreSQL beyond that).
* Analytics read up to 60,000 messages per query window; beyond that, precomputed daily rollups are the next step. Measured: 60k messages / 30k contacts → analytics ≈ 1 s, every list < 100 ms warm.
* AI knowledge base accepts text / pasted content, not PDFs.
* Webhook creation resolves DNS; on a host without outbound DNS it refuses every URL (by design).
* The scheduler is one in-process loop per instance; run a single instance of it (`CAMPAIGN_SCHEDULER=off` on the others) or use the cron route.

## 9. Production deployment steps

```bash
# 0. Provision PostgreSQL, set env vars from section 6 (DATABASE_URL, PRISMA_SCHEMA, AUTH_SECRET,
#    WHATSAPP_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, …)
npm ci                                   # runs prisma generate (postinstall)
npx prisma db push                       # or apply migrations; uses PRISMA_SCHEMA
npm run db:seed                          # super admin (SEED_ADMIN_EMAIL), plans
npm run build && npm start               # self-hosted;  Vercel: just deploy, add the cron below
```

Vercel: add a cron calling `GET /api/cron/campaigns` every minute with the `CRON_SECRET` header; set all variables in Project → Settings → Environment Variables.

After deploy:

1. `GET /api/health` → `{"status":"ok"}` (503 + `degraded` if the DB or `AUTH_SECRET` is missing). Point your uptime monitor here.
2. Sign in as the admin, **change the seed password**, create a first client under Admin → Clients.
3. Register the Meta and Razorpay webhooks (section 7) and send a test event from each dashboard.
4. Take a database backup schedule (daily + before every schema change).

## 9c. Vercel

* Build Command: `npm run build:vercel` — applies the schema (`prisma db push`, additive), seeds plans (and the first admin when `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` are set), then builds. Remove `SEED_ADMIN_PASSWORD` after the first successful deploy so later deploys never reset the admin password.
* Required Production env: `DATABASE_URL`, `PRISMA_SCHEMA=prisma/schema.postgres.prisma`, `AUTH_SECRET`, `WHATSAPP_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`.
* Cron: Vercel **Hobby** only allows daily crons, so no per-minute cron is declared. Campaign/automation timers run when `GET /api/cron/campaigns` is called with `Authorization: Bearer $CRON_SECRET` — point an external pinger (cron-job.org, UptimeRobot, GitHub Actions) at it every minute, or upgrade to Pro and add a cron in `vercel.json`.

## 10. How this was verified

| Check | Command | Covers |
|---|---|---|
| Unit + integration (in-process) | `npm test` | every module, roles, tenant isolation, billing, API, webhooks, campaigns, automations, flows, AI |
| **Security sweep** | `tests/integration/security-sweep.test.ts` | discovers *every* API route: no session → 401; other tenant → 403/404 and no data change; non-admin → 403 on `/api/admin`; hostile bodies/ids never produce a 5xx or leak internals; the set of public routes must equal an allow-list |
| **Final journey** (HTTP) | `E2E_BASE_URL=http://localhost:3100 DATABASE_URL=file:./dev.db npm run test:e2e -- tests/e2e/journey.e2e.ts` | admin creates tenant → users/team → demo WhatsApp → contacts → template → campaign + compliance + send → automation + run → Flow + submit → AI demo → public API → webhook → billing → analytics → admin views → tenant isolation |
| **5-viewport tour** | `tests/e2e/viewport-tour.e2e.ts` (needs `PLAYWRIGHT_CORE`) | every public, client and admin page at 1920, 1366, 820, 412 and 390 px: no console error, no failed request, no horizontal overflow, no placeholder text |
| **Large data** | `tests/e2e/performance.e2e.ts` | 30,000 contacts, 3,000 conversations, 60,000 messages, 300 campaigns |
| Types / lint / build | `npx tsc --noEmit`, `npx eslint`, `npm run build` | |

E2E tests need a running server on the same `DATABASE_URL` and the same `WHATSAPP_ENCRYPTION_KEY` as the test process.
