# Tenancy

**Rule: a clinic can never read or write another clinic's data, and the clinic is never chosen by the client.**

## How the tenant is decided
1. `src/proxy.ts` resolves the request host: platform host → no tenant; `<sub>.TENANT_ROOT_DOMAIN` → tenant with that subdomain; a verified custom domain → its tenant. Unknown or non-ACTIVE/TRIAL clinics get a safe "not available" page.
2. For signed-in users the tenant is the user's own `tenantId` from the session (re-read from the database on each request together with status, role and `sessionsValidFrom`).
3. A user signing in on a clinic host can only be a member of that clinic (or a Super Admin).
4. Request bodies/queries/headers are ignored for tenant choice: schemas do not accept a `tenantId` field.

## How isolation is enforced
- `tenantDb(ctx)` wraps Prisma: every `find/count/aggregate/update/delete/create` on a registered model injects `tenantId = ctx.tenantId`; creating with a different `tenantId` throws. Registered models: `src/lib/tenant/scoped-models.ts`.
- A registry test fails when a new model with a `tenantId` column is not registered (or explicitly exempted with a reason).
- Services take a `RequestContext`, not an id. Look-ups by id use `findFirst({ id, tenantId })`, so a foreign id behaves like "not found" (404, never 403 — existence is not leaked).
- Caches (public site, host lookup, analytics) are keyed per tenant and invalidated on configuration audit events.
- Patients are tenant-scoped records. The same person at two clinics is two patients; nothing links them.
- Super Admin has no tenant. Viewing a clinic requires **support access**: a written reason (≥ 10 chars), password re-entry, 60 minutes, one open session per admin, fully audited; the workspace cookie only works while an open, unexpired record exists.
- Platform aggregates (dashboards, usage) are counts/timestamps — never patient content.

## Evidence
- Automated: tenant-scoping unit tests, cross-tenant service tests per module, `e2e/phase*` two-clinic scenarios (clinic B cannot read/modify clinic A through UI or API), `data-integrity` script (cross-tenant FK check, 0 violations).
- Manual review per release: new route → does it call `apiRoute({tenant:true})` or `requireTenantApiContext`? new model → registered?
