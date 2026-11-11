# Database

129 Prisma models; 113 carry a `tenantId` (clinic-owned) and are only reachable through `tenantDb(ctx)`. The 16 platform-level models (`Tenant`, `Plan`, `Permission`, `RolePermission`, `PlatformSetting`, `PlatformAnnouncement`, `PlatformCounter`, `NotificationEvent`, `CommunicationWebhookEvent`, `SubscriptionWebhookEvent`, `PasswordResetToken`, `SecurityIncidentEvent`, `AuditSeal`, `RetentionPolicy`, `JobRun`, `BackupRun`) hold no clinic content. A test (`tenancy` registry test) fails the build if a model with a `tenantId` column is neither registered as scoped nor explicitly exempted.

## Engines
| | Schema | Migrations |
|---|---|---|
| Development | `prisma/schema.prisma` (SQLite) | `prisma/migrations` |
| Production | `prisma/schema.postgres.prisma` (**generated**: `npm run db:sync-schema`) | `prisma/migrations-postgres` |

Both migration sets are applied from empty in this repository's checks: SQLite on every test run, PostgreSQL 16 verified by applying all migrations to an empty database and running the backup/restore round trip (`docs/BACKUP_DR.md`). The full automated test-suite itself runs on SQLite; it has **not** been run against PostgreSQL.

## Conventions
- Money is integer minor units (`…Minor`), currency stored per invoice. No floating-point money.
- Dates that mean a calendar day are stored as `YYYY-MM-DD` strings in the clinic's timezone; instants are UTC `DateTime`.
- Soft delete (`deletedAt`) for people and clinical records; hard delete only for expired technical rows (`pruneOps`, expired tokens).
- Human numbers (invoice, payment, receipt, token, patient code) come from per-clinic counters (`TenantCounter`) inside transactions, with unique `(tenantId, number)` indexes.
- Idempotency keys on payments, webhooks and scheduled sends so retries cannot duplicate money or messages.
- `AuditLog` rows are append-only: a database trigger rejects updates (SQLite `RAISE(ABORT)`, PostgreSQL function+trigger).
- Sensitive columns: MFA secrets and recovery material are AES-256-GCM encrypted with the `SECURITY_KEYS` ring; passwords are bcrypt (cost 12); API keys and reset tokens are stored hashed.
- Patient clinical fields are **not** column-encrypted (limitation; rely on the managed database's encryption at rest + TLS + tenant isolation).

## Migrations — rules
1. Edit `schema.prisma`, run `npm run db:migrate`, then `npm run db:sync-schema`.
2. Create the PostgreSQL migration: `prisma migrate diff --from-schema <previous schema> --to-schema prisma/schema.postgres.prisma --script`, put it in `prisma/migrations-postgres/<same timestamp>_<name>/migration.sql`.
3. Additive first; destructive changes in a later release (see `docs/DEPLOYMENT.md`).
4. Never edit an applied migration.

## Integrity checks
`npm run qa:integrity` (read-only, SQLite or PostgreSQL): 69 checks — every foreign key between two clinic-owned tables points at the same clinic, invoice totals equal their lines, collected/refunded/due are consistent, payment numbers unique, no negative stock.
