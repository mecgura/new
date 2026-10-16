# Backup, restore and disaster recovery

Only what was actually run is described as verified. Everything else is labelled **not verified**.

## Targets

| | Target | Basis |
|---|---|---|
| RPO (max data loss) | 24 h with the daily backup below; tighter needs the managed-database point-in-time recovery of your host (**not provisioned by this repo**) | backup frequency |
| RTO (time to restore service) | 1 h for a database restore + redeploy | measured restore time is seconds on test data; real time grows with data size and includes your DNS / deploy time |

## What the backup is

`npm run backup` → `scripts/backup.mjs`

1. Consistent snapshot (SQLite online backup API / PostgreSQL `pg_dump -Fc`).
2. gzip → AES-256-GCM when `BACKUP_ENCRYPTION_KEY` is set. In production it **refuses** to write an unencrypted file.
3. SHA-256 + a manifest (row counts of key tables) next to the file.
4. A row in `BackupRun` (what System health reads). Only a folder label is stored — never a path to a secret or a credential.
5. Old files older than `BACKUP_RETENTION_DAYS` (30) in the same folder are pruned.

The script does **not** upload anywhere. Copy `BACKUP_DIR` to off-site storage (a different account/region from the database) with your host's own tooling, and keep `BACKUP_ENCRYPTION_KEY` somewhere else. Uploaded patient files / branding assets live in the database (`TenantAsset`), so they are inside the backup.

Schedule it with your host's cron / scheduled job, e.g. `0 2 * * * cd /app && npm run backup`.

## Restore test (do this on a schedule — an untested backup is not a backup)

`npm run backup:verify -- <file> --record`

- SQLite: decrypts, checks integrity (`PRAGMA integrity_check`) and compares key-table counts to the manifest.
- PostgreSQL: creates a scratch database, `pg_restore`s into it, compares counts, drops it.
- `--record` writes the result into `BackupRun` (`restoreTestedAt`, `restoreOk`, `restoreDurationMs`). System health shows **warn** if the last backup is older than 36 h, if no backup exists, or if the last restore test failed.
- A wrong key or a modified file fails (covered by `src/lib/ops/backup-lib.test.ts`).

## Measured results (this repo, 2026-10-13, test data — not production volumes)

| Driver | Backup | Size | Restore + verify | Result |
|---|---|---|---|---|
| SQLite (seeded dev DB, 130 tables) | 95 ms | 103 KB | 63 ms | ok, 0 problems |
| PostgreSQL 16 (**schema only, empty tables**) | 898 ms | 46 KB | 1990 ms | ok, 0 problems |
| SQLite, wrong key | — | — | — | fails: "incorrect header check" |

The PostgreSQL run proves the tooling path (dump → encrypt → decrypt → restore → count) but **not** timing at real volumes. Re-measure after the first real data load and update this table.

## Restoring for real

1. Stop writes (maintenance page / scale the app to 0).
2. Get the latest verified backup + the key from the separate key store.
3. SQLite: `node scripts/restore-verify.mjs <file>` proves the file; then copy the decrypted DB over the live file (decrypt step is in `unpack` in `scripts/lib/backup-lib.mjs`).
   PostgreSQL: decrypt/gunzip to a `.dump`, then `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" file.dump`.
4. `npx prisma migrate deploy` (applies any migration newer than the backup).
5. Open `/ready` (must be 200) and `/platform/system`; run `npm run security:audit` / the audit integrity check from Platform → Security → Audit to confirm the hash chain.
6. Reopen traffic. Record the incident in `docs/INCIDENT_RESPONSE.md` form.

Note: the audit log is append-only and hash-chained; restoring an old backup removes newer audit rows — document that in the incident record.

## Graceful degradation

| Failure | Behaviour |
|---|---|
| Payment provider down / not configured | Online payment buttons hidden/disabled; offline payment recording keeps working. Nothing is shown as paid unless a verified provider event or a recorded offline payment exists. |
| SMS / WhatsApp / email provider down | Messages go to RETRYING with back-off, then FAILED with a reason; the in-app notification channel is unaffected. Never reported as delivered without provider confirmation. |
| Scheduler not running | System health + `/ready` show the scheduler as warn/not configured; reminders and renewals pause, clinical work is unaffected. |
| A scheduled job throws | Recorded as `FAILED` in `JobRun`, a `JOB_FAILED` security event is raised, other jobs in the tick still run. Jobs are idempotent, so the next tick retries safely. |
| Database down | `/health` stays 200 (process alive, no restart loop); `/ready` returns 503 so the load balancer stops routing. |
| Malware scanner absent | Only images are accepted; `/ready` shows `upload_scanner: not_configured`. |

## Not covered (be honest with clients)

- Point-in-time recovery, cross-region replication, automatic failover: depend on the database host; **not configured here**.
- Automatic off-site upload and a backup-failure pager: not built in; the in-app alert (System health / Security events) is the only alerting.

## Automated backup (GitHub Actions) — added after the independent audit
`.github/workflows/backup.yml` runs daily (20:17 UTC): `pg_dump` of the `health` schema from Neon, a restore into a scratch Postgres 17 with a row-count check (this is the restore drill, repeated every day), AES-256 encryption with `BACKUP_PASSPHRASE`, and a private workflow artifact kept 30 days. Required secrets: `DATABASE_URL_UNPOOLED`, `BACKUP_PASSPHRASE` (store the passphrase somewhere other than GitHub). The repository must stay private. This gives a 24-hour RPO for logical backups; **also enable Neon point-in-time recovery** in the Neon console for a smaller RPO, and note it has not been confirmed from this repository. A restore into the real Neon project is still a manual, approved action (`Restoring for real` above).
