# MECGURA HEALTH — Phase 0 foundation

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
