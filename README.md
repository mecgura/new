# MECGURA Platform

WhatsApp automation platform — shared inbox, CRM, templates, campaigns with compliance checks, visual automations, WhatsApp Flows, AI agent, public API & webhooks, plans/billing/analytics — plus a Super Admin console. Multi-tenant (every record is scoped to a workspace).

Next.js 16 (App Router) · React 19 · Prisma 7 (SQLite dev / PostgreSQL prod) · Auth.js · Tailwind 4.

This is a standalone application with its own database and deployment. It has no connection to any marketing website.

> `AGENTS.md`: this Next.js version has breaking changes — read `node_modules/next/dist/docs/` before changing framework-level code.

## Run locally

```bash
cp .env.example .env            # set AUTH_SECRET (openssl rand -base64 32); the rest is optional
npm install
npx prisma migrate dev          # creates dev.db
SEED_ADMIN_EMAIL='you@example.com' SEED_ADMIN_PASSWORD='choose-a-strong-one' npm run db:seed
npm run dev                     # http://localhost:3000  ·  sign in with the seed admin
```

No Meta / Razorpay / Anthropic credentials are needed: WhatsApp, AI and payments run in clearly labelled **demo mode**.

## Test

```bash
npm test                        # unit + integration (incl. the all-routes security sweep)
npx tsc --noEmit && npx eslint
npm run build && npm start -- -p 3100
E2E_BASE_URL=http://localhost:3100 DATABASE_URL=file:./dev.db npm run test:e2e
```

## Docs

* [`docs/PRODUCTION.md`](docs/PRODUCTION.md) — architecture, database, routes, auth, integrations, env vars, remaining configuration, limitations, deployment
* `docs/PHASE1.md … PHASE9.md` — design notes per module
