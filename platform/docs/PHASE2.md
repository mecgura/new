# MECGURA platform — Phase 2: Super Admin & client management

Builds on Phase 1 (`docs/PHASE1.md`). No WhatsApp connection is made in this
phase — only the management architecture.

## Routes
| URL | Purpose |
|---|---|
| `/admin` | Platform dashboard: clients, numbers, messages, leads, MRR, system status, charts, recent activity/clients |
| `/admin/clients` | Client table + actions (view, edit, suspend/activate, reset access, services, plan, usage, delete) |
| `/admin/clients/new` | Add client (company, owner, mobile, password/generate, plan, status, services) |
| `/admin/clients/[id]?tab=` | Overview · Users · Services · WhatsApp · Plan · Usage · Billing · Activity |
| `/admin/whatsapp` | All registered WhatsApp numbers (registry only) |
| `/admin/billing` | Plan CRUD, MRR, active subscriptions |
| `/admin/usage` | Usage vs plan limits per client |
| `/admin/audit-logs` | Logs & Audit (Phase 1) |
| `/admin/website`, `/admin/agency-clients` | The pre-existing website overview and agency CRM, moved (data untouched) |
| `/admin/organizations` | Redirects to `/admin/clients` |

Templates, Automations, Campaigns, Contacts, AI, API & Webhooks and Support are
shown in the sidebar as **Soon** — they depend on the WhatsApp connection.

## Data model (new)
`Plan`, `Subscription` (history; one `active` row per client, price snapshot),
`OrganizationService`, `OrganizationSettings`, `WhatsAppAccount` (status
`pending` until the integration connects it), `UsageCounter` (daily metered
usage; written by later modules via `incrementUsage`). `Organization` gained
`contactEmail`, `contactPhone`.

## Creating a client (one transaction)
Organization → owner user (or existing account) → CLIENT_OWNER membership →
subscription to the chosen plan → default settings → service flags. Then audit
(`client.created`, `user.created`, `plan.changed`, `service.enabled`) and a
welcome notification.

## Rules enforced server-side
* Only SUPER_ADMIN reaches `/api/admin/**` (CLIENT_OWNER/MANAGER/AGENT → 403).
* A platform admin email can't become a client owner; tenant roles never include SUPER_ADMIN.
* Plan limits: team seats and WhatsApp numbers are checked before creation; downgrades below current usage are refused.
* Suspended clients: every member gets 403 on workspace APIs and a "suspended" screen.
* Delete client needs the exact company name; removes users that belonged only to that client.
* Plan price edits affect new assignments only; plans with history can't be deleted (deactivate instead).
* MRR = sum of active subscriptions of active clients. It is contracted revenue, **not** payments.

## Deploying (PostgreSQL)
```bash
PRISMA_SCHEMA=prisma/schema.postgres.prisma DATABASE_URL="postgresql://…" npx prisma db push
SEED_ADMIN_PASSWORD=… npm run db:seed   # creates Starter/Growth/Pro only if no plans exist; backfills client defaults
```
Back up the database first. Seeded plan prices (₹1,999 / ₹4,999 / ₹9,999) are placeholders — edit them in Billing & Plans.
