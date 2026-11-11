# Deploying to Vercel (GitHub-connected) on health.mecgura.tech

Tested here: full production build against PostgreSQL 16 with `PRISMA_SCHEMA=prisma/schema.postgres.prisma`, `npm run db:seed:production`, and the smoke test (12/12). **Not** tested: an actual Vercel deployment (the assistant had no access to the Vercel account).

## What you need
1. Vercel project from the GitHub repo `mecgura/new`, **Root Directory = `mecgura-health`** (the repo root holds a different app).
2. A PostgreSQL database (Vercel → Storage → Neon, or any managed PostgreSQL with TLS).
3. DNS for `health.mecgura.tech`.
4. Code on the branch Vercel uses as Production Branch (merge PR #2, or set the Production Branch to `ccr-bd70581f-ewcpmd`).

## Environment variables (Project → Settings → Environment Variables)
Scope **Production only** for database and secrets, so preview deployments can never touch the production database.

| Name | Value |
|---|---|
| `PRISMA_SCHEMA` | `prisma/schema.postgres.prisma` (all environments — needed at install/build) |
| `DATABASE_URL` | PostgreSQL URL with `sslmode=require` (Neon: the pooled URL) |
| `APP_ENV` | `production` |
| `APP_URL` | `https://health.mecgura.tech` |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `SECURITY_KEYS` | `k1:<openssl rand -base64 32>` (keep a copy!) |
| `CRON_SECRET` | 16+ random characters (Vercel sends it as `Authorization: Bearer …` to the cron path) |
| `BACKUP_ENCRYPTION_KEY` | `openssl rand -base64 32` (keep a copy; used by the backup script you run elsewhere) |

Then run `npm run env:check -- --file <file>` locally with the same values.

## Domain
Project → Settings → Domains → add `health.mecgura.tech`. At the DNS provider of `mecgura.tech` add the record Vercel shows (normally `CNAME health → cname.vercel-dns.com`). Wait until the domain shows "Valid Configuration".
Clinic subdomains (`clinic.health.mecgura.tech`) need a wildcard domain, which Vercel only issues if `mecgura.tech` uses Vercel nameservers. Until then use custom domains per clinic, or skip `TENANT_ROOT_DOMAIN`.

## First deploy
1. The build runs `prisma migrate deploy` only for Production (see `vercel.json`).
2. After the first successful deploy, create the first Super Admin once, from your computer:
   ```
   PRISMA_SCHEMA=prisma/schema.postgres.prisma DATABASE_URL="<production url>" \
   BOOTSTRAP_SUPERADMIN_EMAIL=you@… BOOTSTRAP_SUPERADMIN_PASSWORD='16+ chars' NODE_ENV=production npm run db:seed:production
   ```
3. `BASE_URL=https://health.mecgura.tech npm run smoke`, then sign in and enrol two-factor.

## Scheduler
`vercel.json` runs the job runner **once a day** (Hobby limit). Reminders and delivery retries need every ~5 minutes: on Vercel Pro change the schedule to `*/5 * * * *`, or call `GET https://health.mecgura.tech/api/internal/communications/run` every 5 minutes from a free external cron service with header `Authorization: Bearer <CRON_SECRET>`.

## Plan and limits
Vercel Hobby is for non-commercial use; a clinic service sold to customers needs Vercel Pro. Serverless functions have time limits and no persistent disk (the app keeps nothing on disk; files are stored in the database).

## Still required before real patient data
Everything in `PRODUCTION_LAUNCH_CHECKLIST.md` (restore drill, alerting, legal text, etc.).
