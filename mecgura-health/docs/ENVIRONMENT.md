# Environment architecture and variables

Three environments, same code, different configuration. **No secret is ever committed**; production values live only in the host's secret store. `npm run env:check` (see below) is the launch gate.

| | Development | Staging | Production |
|---|---|---|---|
| `APP_ENV` | `development` | `staging` | `production` |
| Database | SQLite `file:./dev.db` (`prisma/schema.prisma`) | PostgreSQL (separate database, **never** a copy with real patient data) | PostgreSQL, managed, TLS, backups |
| Seed | `npm run db:seed` (demo clinics A/B, demo users) | `npm run db:seed` may be used for a demo/staging rehearsal; never on a database that holds real data | `npm run db:seed:production` **only** (system roles/permissions + optional first Super Admin) |
| Providers | none configured (nothing is sent) | sandbox keys of each provider | live keys, added one at a time |
| Demo data | yes (`isDemo` tenants) | optional | **none** — the demo seed refuses to run when `NODE_ENV` or `APP_ENV` is `production` |

## Variables, grouped

### Core (required in production)
| Variable | Purpose |
|---|---|
| `APP_ENV` | `production` / `staging` / `development` |
| `DATABASE_URL` | PostgreSQL URL with `?sslmode=require` (or `verify-full`) |
| `PRISMA_SCHEMA` | `prisma/schema.postgres.prisma` — **must be set at install/build time as well as run time** (the generated Prisma client is built for one database type; a SQLite client cannot talk to PostgreSQL) |
| `AUTH_SECRET` | session signing, ≥ 32 chars (`openssl rand -base64 32`) |
| `APP_URL` | public `https://` URL of the platform host |
| `SECURITY_KEYS` | key ring `k2:<base64-32>,k1:<base64-32>` for MFA secrets, audit integrity, signed URLs. First key encrypts new data; **keep old keys** or old data becomes unreadable |
| `CRON_SECRET` | bearer secret for `POST /api/internal/communications/run` (reminders, delivery retries, billing clock, audit seal, pruning). Without it nothing scheduled runs |

### Tenancy / domains
`TENANT_ROOT_DOMAIN` (clinic subdomains `clinic.<root>`; needs wildcard DNS + wildcard TLS on the host). Custom domains are verified by a Super Admin in the console.

### Backups (see `docs/BACKUP_DR.md`)
`BACKUP_ENCRYPTION_KEY` (32 bytes, base64; **store outside the database and outside the backup location**), `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_LOCATION_LABEL`.

### Communication providers — all optional, each off until fully configured
- Email: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` (or `EMAIL_API_KEY`), `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_WEBHOOK_SECRET`
- SMS: `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_ACCOUNT_SID`, `SMS_SENDER_ID`
- WhatsApp: `WHATSAPP_PROVIDER`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`

A channel with missing variables shows **Not configured** (Settings → Integrations, Platform → Communications, `/ready`); messages are never reported as sent unless the provider accepted them.

### Subscription payments — optional
`SUBSCRIPTION_PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (register `<APP_URL>/api/webhooks/subscriptions/razorpay`). Without them Super Admins record offline payments and online checkout is unavailable.

### Operations / tuning
`LOG_LEVEL`, `API_READ_LIMIT_PER_MIN` (1200), `API_WRITE_LIMIT_PER_MIN` (240), `ANALYTICS_CACHE_TTL_MS` (60000), `APP_VERSION`, `GIT_SHA`, `COMMUNICATIONS_INLINE_WORKER`.

### Bootstrap (one-off, remove after use)
`BOOTSTRAP_SUPERADMIN_EMAIL`, `BOOTSTRAP_SUPERADMIN_PASSWORD` (≥ 16 chars) — read only by `npm run db:seed:production`.

### Feature flags
- **Per clinic** (plan/Super Admin): 13 switches (appointments, liveOPD, patientCRM, consultation, lab, followUp, billing, pharmacy, patientPortal, whatsapp, sms, email, analytics) — enforced server-side in `getAccess()`.
- **Per deployment**: `SHOW_PLANNED_MODULES`, `ENABLE_DESIGN_PREVIEW` (keep both off in production).

### Must NOT be set in production
`SEED_DEMO_PASSWORD`, `LOGIN_RATE_LIMIT_IP`, `LOGIN_RATE_LIMIT_ACCT` (test-only), `TENANT_CACHE_TEST`, `ENABLE_DESIGN_PREVIEW=true`.

## The gate

```
npm run env:check -- --file .env.production     # or with the variables already exported
```
Exit code 1 if any **required** item fails (PostgreSQL + TLS, schema selection, secrets present and long enough, https URL, key ring valid, scheduler secret, backup key, no demo/test variables). Optional items print as warnings. It never prints secret values.
