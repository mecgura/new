# MECGURA HEALTH — foundation, multi-tenancy, website, appointments & OPD (Phases 0–3)

White-label doctor & clinic operating system. **Phase 0 only**: design system, app shell, auth, multi-tenant
and role foundations, security, audit, error handling. No clinic modules (patients, OPD, appointments,
prescriptions, billing…) exist yet — by design.

Stack (same as MecguraCampus): Next.js 16 (App Router, `proxy.ts`), React 19, Prisma 7 (SQLite dev / PostgreSQL prod),
Auth.js v5 (credentials, JWT), Tailwind v4, Zod 4, Vitest.

## Run locally
```bash
npm install
cp .env.example .env          # set AUTH_SECRET (openssl rand -base64 32)
npx prisma migrate dev        # creates prisma/dev.db
npm run db:seed               # DEMO data only (refuses in production)
npm run dev                   # http://localhost:3000
```
Demo logins (`*@demo.mecgura.test`): `admin`, `doctor`, `reception` (clinic) and `platform` (super admin);
password = `SEED_DEMO_PASSWORD` or the one printed by the seed.

Checks: `npm run lint && npm run typecheck && npm test && npm run build`.

## Architecture map
| Concern | Where |
|---|---|
| Design tokens (colours, type, spacing, radius, shadow) | `src/app/globals.css` (only place), `src/theme/tokens.ts` |
| UI component library (import from `@/components/ui`) | `src/components/ui/*` — live reference at `/design-system` |
| App shell, sidebar, header, mobile nav | `src/components/shell/*`, `src/app/(app)/layout.tsx` |
| Sidebar config / modules / visibility | `src/config/{navigation,modules}.ts`, `src/lib/navigation.ts` |
| Roles & permissions | `src/lib/permissions/*` |
| Auth (who) / request context (what they may do) | `src/auth.ts`, `src/lib/auth/context.ts` |
| Tenant isolation | `src/lib/tenant/*` (`tenantDb(ctx)`, `scoped-models.ts`) |
| API routes (standard wrapper + error format) | `src/lib/api/handler.ts`, `src/lib/errors.ts` |
| Validation | `src/lib/validation/*` |
| Audit log | `src/lib/audit/*` |
| Logging (auto-redacting) | `src/lib/logger.ts` |
| Security (CSP, CSRF, rate limit, uploads) | `src/proxy.ts`, `src/lib/security/*`, `next.config.ts` |
| SEO helper | `src/lib/seo` |
| Integrations catalogue (all "not configured") | `src/config/integrations.ts` |

## Rules for Phase 1+ (read before adding a module)
1. **Every business table has `tenantId`** + an index starting with it, and is added to
   `src/lib/tenant/scoped-models.ts` in the same commit (a test fails otherwise).
2. **Query tenant data only through `tenantDb(ctx)`**, with `ctx` from `requireTenantApiContext()` /
   the page guards. The raw `db` client is for platform code (auth, seed, audit) only.
3. **Every API route uses `apiRoute({ permission, tenant: true }, …)`**; every page starts with
   `requirePagePermission(...)`. The sidebar only hides links — it is not security.
4. **Use the UI kit and tokens.** No hex colours, no ad-hoc font sizes/spacings in components.
5. **Emit audit events** (`recordAudit`) for the actions listed in `AUDIT_ACTIONS`; never put medical content in metadata.
6. **Never log** request bodies or medical data; the logger redacts by key name as a last resort only.
7. Flip a module to `"available"` in `src/config/modules.ts` only when it really ships.
8. Schema: edit `prisma/schema.prisma`, run `npm run db:sync-schema`, then `prisma migrate dev`; for production
   Postgres generate the matching migration with `prisma migrate diff` into `prisma/migrations-postgres/`.

## Known limits (Phase 0)
- Rate limiting is in-memory per instance (swap `setRateLimitStore` for Redis before multi-instance prod).
- No password reset / user management UI yet (users are created by seed). No tenant admin UI.
- Roles are system roles driven by `ROLE_PERMISSIONS`; DB tables `Role/Permission` are seeded for future custom roles.
- Notifications, global search, integrations are labelled placeholders.


---
## Phase 1 — multi-tenant clinics, white-label, team & RBAC

**What exists:** Super Admin clinic management (`/platform/clinics`: list/filter, create wizard, details, edit, status
changes, domain settings, "enter workspace" with a *Viewing as Super Admin* banner), clinic workspace (dashboard with real
counts + setup checklist, `/team` user management, `/settings/clinic`, `/settings/branding` with logo/favicon upload,
live preview and contrast checks), invitations (`/invite/[token]`), login by email **or phone**, per-clinic status
enforcement (ACTIVE/TRIAL work; SUSPENDED/INACTIVE are blocked on the very next request), doctor/staff profiles,
per-user extra permissions (never admin/platform powers), audit events for all of the above.

**How isolation works (never trust the client):** the clinic is always derived from the session
(`getContext()` re-reads user + clinic from the DB each request). There is no `tenantId` in any clinic API.
Clinic data is read/written only via `tenantDb(ctx)`; foreign ids behave as 404. A Super Admin can act inside a clinic
only through a signed, user-bound cookie set by `POST /api/platform/workspace` (audited). Tests: `npm test`
(`tenancy.integration.test.ts`, `isolation.integration.test.ts`) and the live HTTP suite `e2e/phase1-security.mjs`.

**Invitations:** no email provider is wired, so *nothing is emailed*. The admin sees a one-time link (only its SHA-256 is
stored; 7-day expiry; single use) and must share it themselves.

**Logos/avatars** are validated by magic bytes (PNG/JPG/WebP, no SVG) and stored in the `TenantAsset` table until object
storage is configured (`/api/assets/:id`; logo/favicon public, avatars same-clinic only).

### Domains (application side only)
* `<label>.TENANT_ROOT_DOMAIN` → tenant with that `subdomain`. Needs: wildcard DNS (`*.root → host`), wildcard SSL, and the
  host forwarding the original `Host` header. Locally: set `TENANT_ROOT_DOMAIN=mecgura.test` and map hosts to 127.0.0.1.
* Custom domain (`drsharma.com`) is stored on the tenant and only resolves **after a Super Admin marks it verified**
  (they confirm DNS CNAME/A record + SSL certificate outside the app). Production needs: DNS pointing to the host,
  per-domain SSL (e.g. Vercel/Caddy managed certs), and optionally automated ownership verification (TXT record) — not built.
* On a clinic's host, only that clinic's users (and Super Admin) can sign in.

### Migrations
SQLite (dev): `prisma/migrations/`. PostgreSQL: `prisma/migrations-postgres/` (generated with `prisma migrate diff`; **not yet
executed against a real PostgreSQL server** — run `PRISMA_SCHEMA=prisma/schema.postgres.prisma npx prisma migrate deploy`
on staging first).


---
## Phase 2 — public website + CMS
See [`docs/phase2-website.md`](docs/phase2-website.md). Quick start with the two demo clinics:
```bash
npm run db:seed
NEXT_DIST_DIR=.next-prod npm run build && NEXT_DIST_DIR=.next-prod npx next start -p 3101
# in .env: TENANT_ROOT_DOMAIN="mecgura.test"; map demo.mecgura.test / demo-b.mecgura.test to 127.0.0.1 (hosts file)
# open http://demo.mecgura.test:3101  and  http://demo-b.mecgura.test:3101
# CMS: sign in as admin@demo.mecgura.test → Website
node e2e/phase2-website.mjs     # live checks (needs playwright-core)
```

## Phase 3 — appointments, calendar, live OPD & tokens
Doctor availability, server-side slot calculation, DB-enforced double-booking prevention, day/week/month calendar, reception + doctor live queue with unique daily tokens and priorities, public booking on the clinic website, waiting-room display (tokens only) and a patient token page. Details, rules and roles: [`docs/phase3-appointments-opd.md`](docs/phase3-appointments-opd.md).
Staff pages: `/appointments`, `/opd`, `/settings/scheduling`. Public (clinic host): `/book-appointment`, `/display/<secret>`, `/token/<token>`. Reminders are events only and Google Calendar is an unconfigured interface — nothing is sent or synced yet.

## Phase 4 — Patient CRM & digital file
Patient list/search/registration with duplicate detection, a Patient 360 file (overview, timeline, visits, appointments, allergies, medicines summary, medical & family history, notes, consent, family grouping), archive/restore, and tiered access (identity → view → clinical). Details and rules: [`docs/phase4-patient-crm.md`](docs/phase4-patient-crm.md). Pages: `/patients`, `/patients/new`, `/patients/<id>`. Live check: `node e2e/phase4-patients.mjs` (prod build, after `npm run db:seed`).

## Phase 5 — consultation, prescription & doctor orders
Doctors start a consultation from Live OPD, record vitals, complaint/history/examination, assessment and diagnosis, build and finalize a prescription (versioned, clinic-branded document), plan follow-up and create orders. Finalized records are immutable (amend → new version). No automatic diagnosis, prescribing or medicine data. Details: [`docs/phase5-consultation.md`](docs/phase5-consultation.md). Pages: `/consultations`, `/consultations/<id>`, `/consultations/<id>/prescription`, `/orders`. Live check: `node e2e/phase5-consultation.mjs`.

## Phase 6 — investigations, lab workflow & reports
Doctors order investigations from a consultation; lab staff collect, receive (or reject → recollect) samples with a full chain of custody, enter structured results (flags only from configured reference ranges), generate a report that a lab reviewer verifies and releases as an immutable version, and the doctor reviews it. Configurable test master, categories, sample types, departments and rejection reasons under `/settings/lab`. Pages: `/lab`, `/lab/orders/[id]`, `/lab/reports/[id]`, slip/label print pages; Patient 360 gets a Reports tab and timeline events. External laboratories are tracked manually; no billing, WhatsApp/SMS/email, barcode hardware or AI. Details: [docs/phase6-lab.md](docs/phase6-lab.md).

## Phase 7 — follow-up CRM, recalls & reminders
Follow-ups from consultations, prescriptions, lab reports, no-shows, recalls or manual tasks; a command center (`/followups`), worklist with server-side filters, contact log (manual), booking through the existing appointment engine, reschedule history, outcomes, bounded recalls, in-app reminders, Patient 360 tab/timeline and clinic-level rules (`/settings/followups`). No automatic patient messaging. Details: [docs/phase7-followups.md](docs/phase7-followups.md).

## Phase 8 — billing, invoices, payments & refunds
Configurable service master and tax, invoices with tenant-scoped numbers, discounts with role limits, partial/multiple payments, receipts, refunds with approval workflow, outstanding/overdue, daily collection and reports with CSV, optional cashier sessions, Patient 360 Billing tab, tenant-branded private documents. Integer minor-unit money, server is source of truth. No payment gateway yet ("Payment gateway not configured."). See `docs/phase8-billing.md`.

## Phase 9 — pharmacy, inventory & dispensing
Medicine master, suppliers, purchases with batch + expiry, an immutable stock ledger, FEFO dispensing of finalized prescriptions (partial dispensing, no substitution), returns, low-stock/expiry alerts, pharmacy billing through the Phase 8 invoice engine, reports and branded private documents. Stock only changes through ledger transactions; two staff can't dispense the same stock. See `docs/phase9-pharmacy.md`.
