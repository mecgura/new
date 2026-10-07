# MECGURA platform — Phase 1 foundation

Phase 1 adds the multi-tenant SaaS foundation to the existing MECGURA site
without changing any public URL. Phase 2 modules (WhatsApp, CRM, campaigns,
automations, templates, flows, AI agent, analytics, integrations, API, billing)
appear in the sidebar as disabled **Soon** items — there are no placeholder pages.

## Stack (unchanged)
Next.js 16 (App Router, `src/proxy.ts`), React 19, Tailwind v4, Prisma 7
(SQLite locally / PostgreSQL in production), Auth.js v5 credentials + JWT,
Zod 4, bcryptjs.

## Route groups
| Group | URLs | Layout |
|---|---|---|
| `(site)` | `/`, `/services`, `/blog`, … | Existing public navbar/footer |
| `(auth)` | `/login`, `/forgot-password`, `/reset-password` | Dark auth card |
| `(app)` | `/dashboard`, `/settings`, `/settings/{security,organization,team}` | App shell (client) |
| `admin` | `/admin/**` | App shell (Super Admin) |

## Roles & tenancy
* `User.role` = **platform** role: `SUPER_ADMIN` or `USER` (legacy `admin` ⇒ SUPER_ADMIN).
* `OrganizationMember.role` = **tenant** role: `CLIENT_OWNER`, `MANAGER`, `AGENT`.
* Routes check permission keys (`src/lib/authz.ts → ORG_PERMISSIONS`), never role names,
  so granular/custom roles can be added later.
* `requireOrgAccess(orgId, permission)` (`src/lib/session.ts`) re-loads the user and
  memberships from the DB on every request; the org id from the URL is never trusted.
  Foreign and unknown org ids both return 403. Sub-resources are always queried by
  `(id, organizationId)`.
* Sessions carry a `sessionVersion`; password change/reset, "sign out everywhere" and
  admin disable bump it, killing existing JWTs immediately.

## Defence layers
1. `src/proxy.ts` — JWT check, redirects (fast path only).
2. Server layouts — `(app)/layout.tsx`, `admin/layout.tsx` validate against the DB.
3. API handlers — `handle()` + `requireUser/requireSuperAdmin/requireOrgAccess`,
   Zod validation, same-origin check on writes, rate limits, consistent errors.

## API error shape
`{ "error": "Permission denied", "code": "FORBIDDEN", "details"?: { field: [msg] } }`
— codes: VALIDATION_ERROR 400, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404,
CONFLICT 409, RATE_LIMITED 429, SERVICE_UNAVAILABLE 503, SERVER_ERROR 500.

## Design system
Tokens: `src/app/globals.css` (`--color-app-*`, `--text-display…caption`).
Components: `src/components/ds` (import from `@/components/ds`). The public
marketing site keeps its existing `src/components/ui` styling.

## Deploying the schema to production (PostgreSQL)
The checked-in migrations are SQLite. For the production PostgreSQL database:
```bash
PRISMA_SCHEMA=prisma/schema.postgres.prisma DATABASE_URL="postgresql://…" npx prisma db push
# then, once:
#   UPDATE "User" SET "role" = 'SUPER_ADMIN' WHERE "role" = 'admin';
```
(The app already treats legacy `admin` rows as SUPER_ADMIN, so the UPDATE is housekeeping.)
Take a database backup first.

## Tests
```bash
npm run typecheck && npm run lint
npm test                      # unit + integration (fresh test.db each run)
npm run build && npx next start -p 3100 &
E2E_BASE_URL=http://localhost:3100 npm run test:e2e   # real HTTP login/role/tenant tests
```
