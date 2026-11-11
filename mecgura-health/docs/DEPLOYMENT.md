# Deployment, release and rollback

Target: any Node 22 host that can run `next start` behind HTTPS (a container platform, a VM, or a Node-capable PaaS) + a managed PostgreSQL 16. Only a local PostgreSQL 16 and the production build were exercised in this repository; **no specific cloud host was provisioned or tested** — the steps below are host-neutral.

## Domain architecture
```
https://app.example.com            platform host  → staff sign-in, /platform (Super Admin), APP_URL
https://<clinic>.example.com       clinic subdomain → that clinic's public site, staff login, patient portal   (TENANT_ROOT_DOMAIN=example.com)
https://www.drsharma.com           clinic custom domain → CNAME to the platform; verified by Super Admin (DNS TXT _mecgura-verify.<domain>)
```
Needs: wildcard DNS `*.example.com`, wildcard TLS (or per-domain certificates for custom domains), and the proxy must forward the original `Host` header. Tenant resolution never trusts a request field — only the verified host.

## First deployment
1. Provision PostgreSQL 16 (TLS on, automated backups/PITR on at the provider, a **separate** staging database).
2. Set the variables from `docs/ENVIRONMENT.md` in the host's secret store; run `npm run env:check`.
3. Install + build with the PostgreSQL schema selected:
   ```
   PRISMA_SCHEMA=prisma/schema.postgres.prisma npm ci      # postinstall runs prisma generate for PostgreSQL
   PRISMA_SCHEMA=prisma/schema.postgres.prisma npm run build
   ```
4. Migrate: `PRISMA_SCHEMA=prisma/schema.postgres.prisma npx prisma migrate deploy` (applies `prisma/migrations-postgres`).
5. Bootstrap system data and the first Super Admin: `BOOTSTRAP_SUPERADMIN_EMAIL=… BOOTSTRAP_SUPERADMIN_PASSWORD=… npm run db:seed:production`, then **remove** those two variables.
6. Start: `npm run start` (set `PORT`). Put TLS + `Host` forwarding in front.
7. Schedule the job runner every 5 minutes: `POST <APP_URL>/api/internal/communications/run` with `Authorization: Bearer $CRON_SECRET` (response `{ ok, failedJobs, … }`).
8. Schedule `npm run backup` daily and run `npm run backup:verify -- <file> --record` weekly (`docs/BACKUP_DR.md`).
9. `BASE_URL=https://app.example.com npm run smoke` — all checks must pass. Sign in as the Super Admin and enrol two-factor (required by the production seed).
10. Walk through `PRODUCTION_LAUNCH_CHECKLIST.md`.

## Releasing a change
1. Pipeline (no CI configuration is committed in this repository — add these steps to yours): `npm run typecheck && npm run lint && npm test && npm run security:scan && npm run db:check-schema`, then build.
2. **Migrations are forward-only and must be backwards-compatible with the previous release** (add columns nullable/with defaults; drop or rename in a later release). Take a backup first: `npm run backup`.
3. Deploy to staging, run `npm run smoke` against staging, then production: `prisma migrate deploy` → start new version → `/ready` returns 200 → `npm run smoke`.
4. Check `/platform/system` (jobs, errors, queue) for 15 minutes.

## Rollback
- **App only** (no migration in the release): redeploy the previous build. `/version` shows what is running.
- **Release with an additive migration**: roll back the app; leave the migration in place (old code ignores new nullable columns).
- **Release with a destructive/incorrect migration**: stop traffic, restore the pre-release backup (`docs/BACKUP_DR.md` → "Restoring for real"), redeploy the previous build, record the incident. Writes made after the backup are lost — which is why destructive changes are split across two releases.
- Never edit an applied migration; add a new one.

## Dialect rules
SQLite (`prisma/schema.prisma`) is the source; `prisma/schema.postgres.prisma` is generated (`npm run db:sync-schema`, checked by `npm run db:check-schema`). Each schema change needs both migrations (`prisma/migrations` and `prisma/migrations-postgres`).

## Monitoring and alerting
- Uptime monitor (external) on `GET /health` (liveness) and `GET /ready` (503 when not ready), 1-minute interval, alert to on-call.
- In-app: `/platform/system` (application, database, queue, scheduler, webhooks, storage, errors, jobs, backups) and Security Center events (`JOB_FAILED`, rate limits, sign-in anomalies). In-app alerts reach Super Admins' notification bell only — **there is no pager/e-mail/SMS alerting built in**; wire your uptime monitor to a real on-call channel.
- Logs: one JSON line per event on stdout; ship them with the host's log drain. Sensitive keys are redacted before writing.
- No external error tracker is connected; server errors are kept 30 days in `ErrorEvent` and shown in System health.
