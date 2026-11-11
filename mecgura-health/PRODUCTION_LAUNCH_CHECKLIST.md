# Production launch checklist

Tick every line with a name and date. A line that cannot be ticked is either fixed or recorded as an accepted risk **with an owner**. Commands are in `docs/DEPLOYMENT.md`.

## A. Decisions only a person can make (blockers if empty)
- [ ] Legal entity, privacy policy and terms for the platform and for each clinic reviewed by counsel; the product's "compliance-ready controls" are **not** a certification.
- [ ] Data-protection roles named (who answers patient data-rights requests; who is the incident lead — `docs/INCIDENT_RESPONSE.md`).
- [ ] Hosting region chosen to satisfy the clinics' data-residency expectations.
- [ ] On-call owner and escalation contacts filled in.
- [ ] Support hours/SLA agreed with clinics (`docs/SUPPORT_WORKFLOW.md`).
- [ ] Independent penetration test scheduled/completed (none has been done).

## B. Infrastructure
- [ ] Managed PostgreSQL 16, TLS enforced, encryption at rest **on**, automated backups + point-in-time recovery **on** at the provider, restricted network access.
- [ ] Separate staging database (never real data).
- [ ] App host with HTTPS, HSTS, `Host` header forwarded; wildcard DNS + wildcard TLS for `TENANT_ROOT_DOMAIN`.
- [ ] Log drain configured; uptime monitor on `/health` and `/ready` paging a real person.
- [ ] Off-site, different-account storage for encrypted backups; backup key held separately by at least two people.

## C. Configuration
- [ ] `npm run env:check` passes with the production variables (no FAIL lines; every WARN reviewed).
- [ ] `PRISMA_SCHEMA=prisma/schema.postgres.prisma` at install, build **and** run.
- [ ] `SECURITY_KEYS` generated (two copies stored securely); `AUTH_SECRET`, `CRON_SECRET`, `BACKUP_ENCRYPTION_KEY` unique to production.
- [ ] No demo/test variables (`SEED_DEMO_PASSWORD`, `LOGIN_RATE_LIMIT_*`, `ENABLE_DESIGN_PREVIEW`).
- [ ] Providers: each one enabled **only** after a sandbox test; unused channels left unset (they show *Not configured*).
- [ ] Payment webhook registered and a sandbox payment verified end to end (if online subscription payments are offered).

## D. Data
- [ ] `prisma migrate deploy` applied on the production database from empty.
- [ ] `npm run db:seed:production` run; the first Super Admin created and the bootstrap variables **removed**.
- [ ] Super Admin enrolled in two-factor; recovery codes stored; a second Super Admin exists.
- [ ] Production database contains **no** demo clinics (`SELECT COUNT(*) FROM "Tenant" WHERE "isDemo"` = 0).
- [ ] `npm run qa:integrity` against production: 0 failed checks.

## E. Operations
- [ ] Scheduler calls `/api/internal/communications/run` every 5 minutes; System health shows a recent tick.
- [ ] `npm run backup` scheduled daily; first backup taken; `npm run backup:verify -- <file> --record` **passed on the production database**; restore drill timed and written into `docs/BACKUP_DR.md`.
- [ ] Retention policy and security policy reviewed (Settings → Security for clinics; Platform → Security for platform defaults).
- [ ] `BASE_URL=https://… npm run smoke` all PASS; manual smoke below done.

## F. Manual smoke (15 minutes)
- [ ] Super Admin signs in (with code) → creates a pilot clinic → invites its Clinic Admin.
- [ ] Clinic Admin signs in on the clinic host → sets branding → adds a doctor and a receptionist.
- [ ] Receptionist registers a patient → books an appointment → checks in → doctor consults → prescription finalised → invoice paid → receipt.
- [ ] Patient portal: register/activate → sees only own records.
- [ ] Clinic B (second pilot) cannot see clinic A anything (try an A record id on B).
- [ ] Public website of the pilot clinic loads on its host; unpublished clinic shows "coming soon".
- [ ] A channel that is not configured says so and sends nothing.

## G. Go / no-go
- [ ] Sections A–F complete or risks accepted in writing.
- [ ] Rollback path rehearsed on staging (`docs/DEPLOYMENT.md`).
- [ ] First week plan: daily look at `/platform/system` + Security events; named person reviews every ErrorEvent.
