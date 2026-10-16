# Phase 17 — performance, scaling, backup and operations

## Added
- **Health endpoints** (public, no secrets): `/health` liveness (no DB), `/ready` readiness (DB, migrations, scheduler, queue, storage, providers, scanner, key ring; 503 when not ready; rate-limited), `/version`.
- **Job history** `JobRun` + `recordJob()`; scheduler tick wraps each job (`scheduler`, `message-delivery`, `notifications`, `subscription-billing`, `audit-seal`, `ops-prune`). Response of the cron endpoint reports `failedJobs`.
- **Error store** `ErrorEvent` (sanitised, throttled 30 s per route+code, pruned at 30 days; `JobRun` pruned at 60 days).
- **Backups** `BackupRun` + `npm run backup` / `backup:verify` (encrypted, checksummed, restore-verified). See `docs/BACKUP_DR.md`.
- **System health** (`/platform/system`) now reads real jobs, errors and backups.
- **Tenant-aware cache** (`src/lib/cache/tenant-cache.ts`): keys always include the tenant; invalidated by the audit actions that change the data; public website data cached 30 s; host→tenant lookup caches hits only. Disabled in tests unless `TENANT_CACHE_TEST=on`.
- **Per-user API rate limit** (reads 1200/min, writes 240/min, env-tunable) on top of the sign-in throttles; hits raise a LOW `API_RATE_LIMITED` security event.
- **Benchmarks** `npm run perf` → `perf/RESULTS.md` (synthetic data; guards fail if a query returns nothing).

## Review notes
- **Indexes**: every measured screen is within budget on 20k–200k synthetic rows using the existing `(tenantId, …)` indexes, so no extra index was added in this phase (an unmeasured index only costs write speed). The slowest are appointments week (203 ms) and the platform dashboard (150 ms). Re-run `npm run perf` on PostgreSQL with real volumes.
- **Pagination**: the benchmarked lists (patients, invoices, notifications, audit centre, security events) are paginated; other lists were not re-audited in this phase.
- **OPD realtime**: the queue uses ETag polling (304 when unchanged), not websockets, so there is no connection state to scale; the cost is one cheap indexed query per poll.
- **Rate limiter**: in-memory per instance. With more than one instance the effective limit multiplies; use a shared store (Redis) before scaling horizontally — listed as a known limitation.
- **Logs**: one JSON line per event in production with automatic redaction. Job logs carry `channel: "job"`; security and audit events are stored in their own tables (SecurityEvent, AuditLog) rather than only in logs. Other log lines are not channel-tagged yet. No patient data is logged.
- **Analytics freshness**: analytics cache TTL is `ANALYTICS_CACHE_TTL_MS` (default 60 s) and keyed by tenant/range/filters/role.
