# Architecture

MECGURA HEALTH is a white-label, multi-tenant Doctor & Clinic OS: one deployment serves many clinics, each with its own branding, domain, staff, patients, website and data.

## Stack
Next.js 16 (App Router, React 19, server components + route handlers) · Prisma 7 (SQLite in development, PostgreSQL in production) · Auth.js v5 (JWT sessions) · Zod 4 validation · Vitest (unit + integration against a throw-away database) · Playwright-core scripts (`e2e/`) against a production build.

> This is a newer Next.js than most documentation describes (async `params`, `proxy.ts` instead of `middleware.ts`). Read `node_modules/next/dist/docs/` before changing framework-level code (see `AGENTS.md`).

## Layers
```
Browser ─► src/proxy.ts (host → tenant, public/auth gate, CSP nonce, security headers)
        ─► app routes
             • pages (src/app/(app)/…)        server components, call requirePagePermission()
             • API (src/app/api/**/route.ts)   apiRoute(): CSRF → auth → tenant → permission → rate limit → JSON envelope
        ─► services (src/lib/services/*)      business rules, re-check permission + ownership, write audit
        ─► tenantDb(ctx) (src/lib/tenant/db)  every query on a clinic-owned table is forced to the caller's tenant
        ─► Prisma ─► SQLite | PostgreSQL
```
| Concern | Where |
|---|---|
| Request context (user, tenant, role, permissions, enabled modules, subscription state) | `src/lib/auth/context.ts` |
| Role → permission catalogue (122 permissions, 12 roles) | `src/lib/permissions/` |
| Tenant isolation | `src/lib/tenant/` (`tenantDb`, `scoped-models.ts`, host resolution) |
| Audit (hash-chained, append-only) | `src/lib/audit/`, `src/lib/services/sec-audit.ts` |
| Security (MFA, API keys, privacy, events, incidents) | `src/lib/security/`, `src/lib/services/sec-*.ts` |
| Operations (health, jobs, errors, cache, backups) | `src/lib/ops/`, `src/lib/cache/`, `scripts/backup*.mjs` |
| Communications (email/SMS/WhatsApp/in-app, templates, queue, webhooks) | `src/lib/communications/` |
| Notifications centre | `src/lib/notifications/` |
| Subscriptions & plans (MECGURA bills clinics) | `src/lib/subscriptions/`, `src/lib/services/sub-*.ts` |
| Clinical flow | scheduling → OPD queue → consultation → prescription → lab → follow-up → billing → pharmacy (`src/lib/services/*`) |
| Public website per clinic | `src/lib/website/`, `src/app/site/` |
| Patient portal | `src/lib/portal/`, `src/app/portal/`, `/api/patient/*` |

## Product modules (all built, all behind permissions and per-clinic switches)
Dashboard · Appointments · Live OPD queue · Patient CRM · Consultation & prescription · Lab · Follow-ups & recalls · Billing · Pharmacy & stock · Patient portal · Communications · Notifications · Analytics & reports · Public website · Team · Settings · Platform console (clinics, users, roles, domains, features, plans/subscriptions, communications, system health, security, audit) · Security Center.

## Data flow rules
- The tenant comes from the verified host or the session — never from a request body.
- Pages and routes only authenticate and shape input; **services** re-check permission, clinic and record ownership, so a missed route guard still cannot leak data.
- Every state change that matters writes an audit row (ids and counts only — no patient content, no secrets).
- Providers (email/SMS/WhatsApp/payment) sit behind interfaces; a provider that is not fully configured is `not configured` and nothing is claimed as sent or paid.
- AI is not used for any clinical decision; there is no clinical AI in the product.

## What the app does not do
No telemedicine video, no insurance claims, no government health-ID integration, no e-prescription transmission to pharmacies outside the clinic, no automatic payment capture without a configured provider. Each is a roadmap item, not a hidden feature.
