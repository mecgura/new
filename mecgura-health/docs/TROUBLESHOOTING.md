# Troubleshooting

Start with `/ready` (what is unhealthy), `/platform/system` (jobs, errors, queue, backups) and the request id in the error (`X-Request-Id`, also in the JSON error body) to find the log line / `ErrorEvent`.

| Symptom | Likely cause | Fix |
|---|---|---|
| `/ready` 503, `database: down` | DB unreachable / credentials / TLS | Check `DATABASE_URL`, provider status, network allow-list. App stays up (`/health` 200) |
| `/ready` `migrations: warn` | unfinished migration | `npx prisma migrate status`; re-run `migrate deploy`; never edit applied migrations |
| `PrismaClientInitializationError … adapter-pg … not compatible with provider sqlite` | client generated from the SQLite schema | set `PRISMA_SCHEMA=prisma/schema.postgres.prisma` then `npx prisma generate` and rebuild |
| Reminders / follow-ups / delivery retries not happening | scheduler not calling the job runner | schedule `POST /api/internal/communications/run` with `Authorization: Bearer $CRON_SECRET`; `/platform/system` → Scheduler shows last tick |
| Job shows FAILED | exception inside one job | System health → Background jobs → last error text; other jobs still ran; next tick retries (jobs are idempotent) |
| "Not configured" on SMS/e-mail/WhatsApp/payments | provider variables missing | `docs/INTEGRATIONS.md`; this is intentional — nothing is sent |
| Messages stuck in QUEUED/RETRYING | provider outage or scheduler off | Platform → Communications; fix provider, scheduler resumes; FAILED shows a reason |
| Clinic site shows "not available" | clinic not ACTIVE/TRIAL, host not resolved, domain unverified | Platform → Clinics / Domains; DNS + wildcard TLS; `TENANT_ROOT_DOMAIN` |
| Website edit not visible immediately | public site cache (30 s TTL, invalidated on save) | wait 30 s; confirm the change was published |
| User "locked" | too many failed sign-ins | wait for the lock window or Clinic Admin / Super Admin resets; check Security events for abuse |
| MFA code rejected | clock drift, or code already used (single-use per 30 s) | sync device time; wait for next code; use a recovery code; Super Admin can reset MFA (audited) |
| 429 Too many requests | per-user or sign-in throttle | wait `Retry-After`; for automation use an API key and respect limits |
| "Subscription blocked" banner | clinic subscription unpaid/blocked | Clinic Admin → Subscription; Super Admin → Subscriptions |
| Backup warn in System health | none in 36 h / restore never tested / last restore failed | run `npm run backup`; run `npm run backup:verify -- <file> --record`; check `BACKUP_ENCRYPTION_KEY` |
| Audit verify fails | tampering, restore of an older backup, or key ring changed | open a security incident; compare with last seal; ensure old `SECURITY_KEYS` entries are kept |
| E2E logins fail with "too many attempts" | login throttle exhausted by test loops | tests only: `LOGIN_RATE_LIMIT_IP/ACCT` env; never in production |

## Useful commands
```
npm run env:check            # production variable gate
npm run smoke                # BASE_URL=… read-only production smoke test
npm run qa:integrity         # read-only data integrity report
npm run backup / backup:verify
npx prisma migrate status
```
