# MECGURA HEALTH — Final Independent Production Readiness Audit

Audit date: 2026-10-14. **Audit-only: no source, config, schema, migration, dependency, database or hosting change was made.** The only file created is this report. Nothing was committed, pushed or deployed.

## Verdict

# NOT READY FOR PRODUCTION  ·  READY FOR STAGING

The code base is real, internally consistent and well tested: type-check, lint, 746 unit/integration tests, a production build and 16 end-to-end suites all passed in this audit. It is **ready for a staging environment with synthetic data.** It is **not ready to hold real patient data**, because of operational and security gaps that no test can cover (section 12), most importantly: no scheduled/off-site backup and no tested restore on the real database, no real notification provider configured, a once-a-day scheduler on the Hobby plan, an in-memory rate limiter on a serverless host, temporary debug code live in production, and a Super Admin password that has been exposed in a chat transcript and not yet rotated / 2FA-enrolled.

Evidence for each claim is in the sections below. Anything not run is marked **NOT RUN / BLOCKED / NOT VERIFIED**; nothing is claimed that was not executed or read.

---

## 1. Repository and commit inspected

| Item | Value (verified by command) |
|---|---|
| Working copy audited | `/home/user/new/mecgura-health` (has `node_modules`), remote `mecgura/new`, branch `ccr-bd70581f-ewcpmd`, HEAD `59b1e36` |
| Deployed repo | `/home/user/health`, remote `mecgura/health`, branch `main`, HEAD `12dc5aa` |
| Working tree | `git status --short` empty in both repos (clean) |
| Tree equality | `diff -rq` (excluding node_modules/.git/.next/db/env): identical except `docs/VERCEL_DEPLOY.md` (differs) and git-ignored build artefacts |
| Tracked files | 1131 (`git ls-files`) |
| Runtime | Node v22.22.0, npm 10.9.4, Next.js 16.4.0 (Turbopack), React 19.2.8 |
| Production deployment | Vercel project `health`, deployment `dpl_5raZ6eaWL3Dzc3jRj7v9ttQa5pFX`, state READY, commit `12dc5aa` (Vercel API, read-only) |

Caveat: `/home/user/health` has no `node_modules`; checks ran on the working copy, whose source is identical to the deployed repo apart from the one doc file.

## 2. Architecture (as found in code)

- **Frontend/back end:** Next.js App Router, server components, route handlers (`src/app/api/*`), server actions; `src/proxy.ts` (Next 16 replacement for middleware) sets a per-request nonce CSP (`strict-dynamic`) and an optimistic session gate.
- **Database/ORM:** Prisma 7. SQLite (better-sqlite3 adapter) in development; PostgreSQL (pg adapter) in production via `PRISMA_SCHEMA=prisma/schema.postgres.prisma` (generated, `db:check-schema` verifies sync) and `prisma/migrations-postgres`. 18 migrations. `DATABASE_SCHEMA` isolates the app in schema `health` on a shared Neon database.
- **Auth:** Auth.js v5 (JWT sessions, 8 h), bcrypt cost 12, DB-backed lockout (5 failures/15 min), TOTP + hashed backup codes, `sessionsValidFrom` revocation, separate patient-portal credentials provider.
- **Authorization:** TS role→permission map (`src/lib/permissions/roles.ts`); service-layer guards on every call; `apiRoute` wrapper; static test `route-guards.test.ts`.
- **Tenancy:** host-based tenant resolution (`src/lib/tenant/host.ts`, `resolve-core.ts`); `tenantDb()` Prisma extension rewrites queries on ~100 registered models; `scoped-models.test.ts` fails if a tenant model is unregistered; tenant never read from request body.
- **Storage:** only `TenantAsset` rows in the database (logos, favicons, avatars, site images). No object storage, no patient document upload (patient documents are generated HTML).
- **Background jobs:** a single cron route `/api/internal/communications/run` (Bearer `CRON_SECRET`), run daily at 02:00 UTC (`vercel.json`). It runs scheduler, message delivery, notifications, subscription billing, audit sealing, ops pruning.
- **Integrations (code):** Resend (email), Twilio (SMS), Meta WhatsApp Cloud, Razorpay (subscription billing). Clinic-level online payments (`payment-gateway.ts`) and OTP login (`otp.ts`) are explicit null stubs. No malware scanner, no medicine/ICD/drug-safety source, no external error monitoring.
- **Deployment config:** `vercel.json` (`npm ci`, `node scripts/vercel-build.mjs`, one cron); build script migrates, seeds system data, builds. **No `.github/workflows` (no CI).**
- **Env requirements:** documented in `docs/ENVIRONMENT.md`, enforced by `scripts/check-env.mjs` and the build script.

## 3. Phase-by-phase status

Classification is from reading source and tests (static review by three read-only reviewers plus my own spot checks) combined with executed test results (section 4). "VERIFIED" means implemented, permission/tenant-guarded and covered by passing tests; it does **not** mean provider-connected.

| # | Phase | Status | Key evidence | Main gaps |
|---|---|---|---|---|
| 0 | Foundation & design system | VERIFIED (a11y tested only in e2e/axe, not component tests) | `src/components/ui/*` (20 primitives), `src/theme/tokens.ts`, `contrast.ts`, `design-system` page behind `settings.edit` | "coming soon" disabled nav items; no component-level tests |
| 1 | Multi-tenant, white-label, RBAC | VERIFIED | `src/lib/tenant/{db,scope,host,resolve-core}.ts`, `auth/context.ts`, `isolation.integration.test.ts`, `scoped-models.test.ts`, `route-guards.test.ts`, e2e phase1 (71 checks) | roles are a TS map, custom roles not supported; Super Admin blanket permissions (finding M1) |
| 2 | Public website & CMS | VERIFIED | `src/app/site/*`, `website-*.ts` services, DNS TXT domain verification, e2e phase2 (76) | one template; enquiries trigger no email; a doc line is stale |
| 3 | Appointments, calendar, Live OPD | VERIFIED | `appointments.ts`, `slotLock` unique constraint, `opd.ts`, e2e phase3 (133) | no reminders unless Phase 11/12 + provider; no Google Calendar; display endpoint unthrottled |
| 4 | Patient CRM / Patient 360 | VERIFIED | `patient-crm.ts` tiered access, audited export, e2e phase4 (130) | patient merge not implemented |
| 5 | Consultation & prescription | PARTIALLY IMPLEMENTED | `consultation.ts`, `prescription.ts` (versions, content hash), e2e phase5 (110) | no medicine database/import UI, no drug-interaction/allergy check, HTML not PDF |
| 6 | Investigations & lab | PARTIALLY IMPLEMENTED | `lab-*.ts`, `lab/core.ts`, e2e phase6 (97) | no external-lab API/analyzer interface, HTML reports, no test pricing |
| 7 | Follow-up CRM | VERIFIED | `followups.ts`, `recalls.ts`, e2e phase7 (62) | reminders synced lazily, not by a job |
| 8 | Clinic billing | VERIFIED (offline) / PARTIAL (online) | `billing-*.ts`, idempotency key, e2e phase8 (111) | online payment methods throw "gateway not configured" |
| 9 | Pharmacy & inventory | VERIFIED | `pharmacy-core.ts` (`applyStock` compare-and-swap + ledger), e2e phase9 (139) | none material |
| 10 | Patient portal | PARTIALLY IMPLEMENTED | `portal/ctx.ts`, `portal-records.ts` (patientId scoping, status filters), e2e phase10 (135) | no OTP login; no online pay |
| 11 | WhatsApp/SMS/Email | PARTIALLY IMPLEMENTED | real adapters for Resend/Twilio/Meta, signature verification (Meta HMAC-256, Twilio HMAC-1, Svix+300 s window), idempotent webhooks, e2e phase11 (56) | **every channel NOT_CONFIGURED in production**; nothing can send; no provider-level unit tests |
| 12 | Notification center | VERIFIED (in-app) | `notifications.ts` user+tenant scoped, e2e phase12 (56 on re-run) | jobs run only daily on Hobby plan |
| 13 | Analytics & reports | PARTIALLY IMPLEMENTED | `analytics-core.ts`, 15 reports, exports, e2e phase13 (83 on re-run) | scheduled reports are stored but never generated/sent |
| 14 | Super Admin | VERIFIED | `src/app/(app)/platform/*`, `platform-core.ts` guard, e2e phase14 (151) | no `platform/layout.tsx` guard (service guards only); a stale "not implemented" string in `platform-admin.ts:59` |
| 15 | Clinic subscription billing | PARTIALLY IMPLEMENTED | plans/invoices/dunning, real Razorpay client, HMAC over raw body + `timingSafeEqual`, event-id claim, re-fetch, e2e phase15 (73) | **no live Razorpay credentials/test**; no mandates/proration; no timestamp window (idempotency only) |
| 16 | Security, privacy, audit | PARTIALLY IMPLEMENTED | TOTP, session revocation, audit HMAC + DB trigger + daily seals, consent/rights workflow, CSP/HSTS, e2e phase16 (86) | see section 6 |
| 17 | Performance, backup, DR | PARTIALLY IMPLEMENTED | `scripts/backup.mjs` (AES-256-GCM), `restore-verify.mjs`, `docs/BACKUP_DR.md`, `/ready` | **backups manual only; restore not tested on Neon**; Phase 17 e2e not re-run here |
| 18 | Final QA | PARTIALLY VERIFIED | reports are largely honest; suite real | Phase 18 QA sweep, a11y, Postgres perf **not re-run**; reported test count (742/745) differs from actual 746 |
| 19 | Deployment & launch readiness | PARTIALLY IMPLEMENTED | `vercel-build.mjs`, `check-env.mjs`, `smoke-test.mjs`, `docs/VERCEL_DEPLOY.md`, `docs/DEPLOYMENT.md` (has Rollback), live deploy READY | **0 of 36 launch-checklist boxes ticked**; no CI; no monitoring/alerting; rollback never rehearsed |

## 4. Verification commands and actual results

All run in `/home/user/new/mecgura-health`. Raw outputs were saved outside the repo.

| # | Command | Result |
|---|---|---|
| 1 | `git status --short` (both repos) | clean |
| 2 | `npx tsc --noEmit` | exit 0, no errors |
| 3 | `npx eslint` | exit 0: **0 errors, 11 warnings** (unused variables in tests/e2e) |
| 4 | `npx vitest run` | **37 files, 746 tests passed, 0 failed, 0 skipped** (118 s; SQLite test DB in `.test-db/`) |
| 5 | `npm run security:scan` | "Security scan passed (1089 files)" |
| 6 | `npm run db:check-schema` | "schema.postgres.prisma is in sync" |
| 7 | `npx prisma validate` | schema valid |
| 8 | `NEXT_DIST_DIR=.next-prod npx next build` | exit 0 (build succeeded) |
| 9 | `npm audit --omit=dev` | exit 1: **4 high** (see 6.9) |
| 10 | `npm audit --json` (all) | 12 total: 2 critical, 9 high, 1 moderate |
| 11 | e2e phases 1–16 against the production build on a **scratch SQLite DB copy** (port 3401) | see below |
| 12 | Read-only GETs on production: `/ready`, `/api/health` | 200; `/ready` status **degraded** (scheduler warn: last tick 571 min ago) |

**E2E results (first full run):** phases 1–11 and 14–16 passed with 0 failures (71, 76, 133, 130, 110, 97, 62, 111, 139, 135, 56, 151, 73, 86 checks). **Phase 12 failed 2 checks** (bell-panel list/"View all"; priority wording) and **phase 13 failed 1 check** ("billing page states what its figures mean"). **Re-running phases 12 and 13 alone passed 56/0 and 83/0.** Treated as flaky UI-timing checks, not reproduced, but not root-caused — recorded as a test-reliability risk rather than ignored.

**Totals:** unit/integration 746 passed / 0 failed / 0 skipped; e2e ≈1,500 checks passed; 3 transient e2e failures on first run, 0 on re-run.

**NOT RUN / BLOCKED:** Phase 17 e2e (backup/restore), Phase 18 QA sweep (role×page matrix, axe, responsive), `npm run perf`, PostgreSQL-backed test suite (the suite is SQLite-only), `npm run smoke` against production, `npm run backup` / `backup:verify` (would write backups / need `pg_dump`), `prisma migrate deploy` (modifies DB), any penetration test, any provider call (no credentials; would send messages/payments). Existing CI results: **none exist** (no workflows).

## 5. Tests passed / failed / skipped / blocked

Passed: items 2–8 above, vitest 746, e2e as listed. Failed (transient): 3 e2e checks, passed on re-run. Skipped: 0. Blocked/not run: see end of section 4.

## 6. Security findings (ranked)

No unauthenticated cross-tenant data route and no IDOR was found by static review or by the passing isolation/e2e suites. **This is not a penetration test; none was performed.**

### High
- **H1 — Temporary debug script live in production.** `src/app/layout.tsx:27-36` (commit `e954d08`, deployed) injects an inline script on every page including login and the patient portal that prints error messages, stack traces and, after 5 s, the first 300 characters of `body.innerHTML` into a red overlay when `#main` is absent. It can expose internals and rendered patient data on screen. Not an XSS vector (static string, `textContent`). Must be removed after the blank-login issue is closed.
- **H2 — Super Admin credential exposure and no 2FA yet.** The first Super Admin password was displayed in the assistant chat and remains stored as a Vercel sensitive env var (`BOOTSTRAP_SUPERADMIN_PASSWORD`, reset flag now `no`). The production seed sets Super Admin as MFA-required (`seed-production.ts:57-59`; the code default `mfaRequiredRoles: []` in `sec-policy.ts:13` is otherwise empty), but TOTP enrolment has not been performed and the password has not been rotated. Treat the password as compromised.
- **H3 — Rate limiter is per serverless instance.** `src/lib/security/rate-limit.ts` is an in-memory Map; `setRateLimitStore` is never called. IP limits, password-reset limits, portal activation, public booking and TOTP-attempt limits are weak across Vercel instances. Password lockout is DB-backed and survives; TOTP guessing has no DB-backed lockout.
- **H4 — No scheduled/off-site backup** (section 9).

### Medium
- **M1 — Super Admin holds `ALL_PERMISSIONS`** (`roles.ts:14`); only consultation/orders/lab block it. During support access it passes `loadPatient(...,"clinical")` and `patients.export` (`patient-crm.ts:44-48, 351-353`) and can read/export clinical data. Add the same exclusion or document as intended.
- **M2 — No field-level encryption of patient data**; `encryptString` is used for MFA secrets only. Relies on database at-rest encryption (Neon). `docs/SECURITY.md` states this.
- **M3 — Audit integrity is per-row HMAC + DB UPDATE-trigger + daily seals**, not a per-row chain; rows since the last seal rely on their own HMAC; `recordAudit` swallows write failures. (The "hash chain" wording in earlier reports overstates this.)
- **M4 — No malware scanner** (`assertScanned` passes when none registered); uploads limited to validated images.
- **M5 — No external alerting/monitoring** (errors go to a DB table and in-app alerts only).
- **M6 — Erasure requests can never reach FULFILLED** (`sec-privacy.ts:75`) — compliance gap if clinics expect deletion.
- **M7 — `/ready` is public** and discloses provider-configuration state, migration state and scheduler lag (`PUBLIC_PATHS` in `proxy.ts`).
- **M8 — Dependency advisories:** `npm audit --omit=dev` reports 4 high via `prisma → @prisma/config → deepmerge-ts` and `mysql2` (Prisma CLI/dev tooling, not the request path per `security-review/FINDINGS.md` #2); full audit adds 2 critical in `vitest`/`tinypool` (dev only). Not exploitable at runtime on current evidence, but unresolved; the fix proposed by npm is a breaking Prisma downgrade, so it needs a deliberate decision.

### Low
- L1 `requireApiContext` (`auth/context.ts:209`) does not reject `role === "PATIENT"`; services still deny (patients hold no permissions). Hardening only.
- L2 Webhook rate-limit bucket keys on first `x-forwarded-for` value (spoofable); signatures still gate every webhook. Razorpay has no timestamp window (idempotency + provider re-fetch cover replay).
- L3 `/api/public/display/[key]` and `/api/assets/[id]` (raw `db`, unscoped by tenant for public asset kinds) have no/limited throttling; ids are unguessable.
- L4 ~100 `apiRoute` routes declare no `permission:`; authorization lives in services. `route-guards.test.ts` verifies a guard exists, not which permission — a future service function could omit its check unnoticed.
- L5 No CI, no push-time secret/dependency scanning (`security:scan` is manual).

### Checked and found clean
- Secrets: `git grep` for live-key patterns found none (only the documented example URL with a masked password); `git log -S"BEGIN PRIVATE KEY"` found 0; `.env` is untracked, only `.env.example` is tracked; no `*.db` tracked.
- Demo credentials: demo seed refuses production (`prisma/seed.ts:17`).
- Production headers (live): CSP with nonce + `strict-dynamic`, HSTS (2 years, preload), X-Frame-Options DENY, nosniff, COOP, Permissions-Policy, Referrer-Policy.
- Webhook signature verification and `timingSafeEqual` present for Meta, Twilio, Resend/Svix, Razorpay; unsigned/disabled returns 503.
- Payment idempotency present (clinic billing key, dispensing key, subscription `pay:provider:paymentId`).

## 7. Tenant-isolation verification status

**VERIFIED in test and code; NOT verified by an independent penetration test and NOT verified on PostgreSQL.** Evidence: `tenantDb` rewrite of every query on ~100 models; test that fails on unregistered tenant models; `isolation.integration.test.ts` / `tenancy.integration.test.ts` (hostile `where`, cross-tenant update/create); per-module cross-tenant service tests; two-clinic scenarios in e2e phases 1–16 (all passing); login enforces host→tenant. Residual: raw `db` use in `notifications.ts`, `portal-auth.ts`, `assets` route is individually scoped by explicit `tenantId`/ids (reviewed, no leak seen) but is not defence-in-depth; one tenant-scoping unit test covers only the `user` model. The isolation tests ran on SQLite; Postgres behaviour of the same code path was exercised only by the manual login/seed on Neon and an earlier local Postgres run, not by the suite.

## 8. Database and migration status

- Schema valid (`prisma validate`); Postgres schema in sync (`db:check-schema`); 18 migrations in `prisma/migrations` (SQLite) and `migrations-postgres`.
- Production (Neon, schema `health`): build log of deployment `dpl_5raZ…` shows "No pending migrations to apply", `/ready` reports database ok and "migrations: all applied". Migrations run over the direct (unpooled) connection with the advisory lock disabled.
- Risks: the build script runs `migrate deploy` and the seed on **every** deploy — acceptable for additive migrations, no rehearsed rollback for a destructive one; the database is **shared** with another application (isolated by schema, not by instance); `RESET_EMPTY_DATABASE` exists but is guarded and disabled.
- Not verified: Postgres performance (all perf numbers are SQLite); migration run on a production-size dataset.

## 9. Backup and restore status

| Question | Finding |
|---|---|
| Database backups exist? | **NOT VERIFIED.** Script `scripts/backup.mjs` exists (pg_dump/SQLite API, gzip, AES-256-GCM, checksum, manifest) but is **manual**; `vercel.json` schedules no backup; Vercel has no `pg_dump`. Neon point-in-time recovery may exist but was **not confirmed**. |
| File/document backups? | Files are DB rows, so covered only by DB backups. No object storage. |
| Protected? | Script encrypts; no off-site upload exists. |
| Retention configured? | Not for backups in-repo; audit retention is a policy setting. |
| Restore tested? | `restore-verify.mjs` was run earlier on seeded SQLite and an empty-schema Postgres 16 (2026-10-13). **No restore on Neon or on real data — NOT VERIFIED.** Not re-run in this audit (would need `pg_dump`/scratch DB; not production-safe to attempt against Neon). |
| RPO/RTO documented? | Yes in `docs/BACKUP_DR.md` (RPO 24 h, RTO 1 h) — **estimates, not met by any automated mechanism in the repo.** |

## 10. Integration status

| Integration | In code | Config present (prod) | Provider connection verified | E2E passed | Production-ready |
|---|---|---|---|---|---|
| PostgreSQL (Neon) | Yes | Yes | Yes (`/ready` database ok, migrations applied) | Seed/login on Neon; suite on SQLite | Partially — backup/restore unverified |
| File storage | DB-only (`TenantAsset`) | n/a | n/a | e2e assets | Images only; no object storage |
| Email (Resend) | Yes | **No** (`not_configured`) | No | Simulated provider, signature tests | **No** |
| SMS (Twilio) | Yes | **No** | No | Simulated | **No** |
| WhatsApp (Meta) | Yes | **No** | No | Simulated | **No** |
| Payment gateway — subscriptions (Razorpay) | Yes | **No** (`none`) | No | Simulated webhooks | **No** |
| Payment gateway — clinic/patient online | **Stub (`null`)** | No | No | n/a | **No** |
| OTP login | **Stub (`null`)** | No | No | n/a | **No** |
| Background jobs | Yes | Yes (`CRON_SECRET`) | Vercel cron daily | Cron route tested | **Inadequate** — daily on Hobby; `/ready` already "degraded" |
| Monitoring/alerting | DB `ErrorEvent` + in-app only | No external | n/a | n/a | **No** |
| Malware scanner | Interface only | **No** | n/a | n/a | **No** |
| Custom domains / SSL | DNS TXT verification, Vercel domains | `health.mecgura.tech` live | Yes (HTTPS, HSTS served) | e2e (subdomain host tests) | Clinic custom-domain onboarding not exercised on production |

## 11. Deployment status

- Production build succeeds locally (exit 0) and on Vercel (READY, commit `12dc5aa`).
- Env vars documented (`docs/ENVIRONMENT.md`), enforced by `check-env` and the build script (fails clearly when settings are missing).
- Health checks: `/health`, `/api/health`, `/ready` exist and respond (live: `/api/health` ok; `/ready` degraded — scheduler stale because cron is daily).
- HTTPS/domain: `health.mecgura.tech` serves over HTTPS with HSTS; platform host handled (`parseTenantHost`).
- Rollback: documented in `docs/DEPLOYMENT.md`; **never rehearsed** (checklist item unticked); Vercel instant rollback is available but untested.
- Error monitoring: none external.
- Version traceability: Vercel deployment id ↔ commit `12dc5aa` verified; `/version` route exists (not queried).
- Leftover operational state in Vercel: `BOOTSTRAP_SUPERADMIN_*` variables still present (password value stored as a sensitive var; reset flag `no`).
- **0 of 36** `PRODUCTION_LAUNCH_CHECKLIST.md` items are ticked.

## 12. Critical blockers (must be resolved before any real patient data)

1. **Backup/restore:** automated, off-site, encrypted backups (or confirmed Neon PITR with retention) and a **successful restore drill on the real stack**; document the actual RPO/RTO.
2. **Remove the TEMP-DEBUG script** (H1) from production.
3. **Rotate the Super Admin password, enrol TOTP**, delete the `BOOTSTRAP_SUPERADMIN_*` variables, and treat the exposed password as compromised (H2).
4. **A real notification path:** configure and test at least email (and SMS/WhatsApp if promised) with the provider's sandbox → production, with signed-webhook verification against real provider traffic.
5. **Scheduler cadence:** a daily cron cannot drive reminders, retries, escalations or dunning; move off Hobby limits or use an external scheduler hitting the secured route every few minutes.
6. **Distributed rate limiting** (Redis/Upstash store via `setRateLimitStore`) and a DB-backed TOTP lockout (H3).
7. **Independent penetration test** and a legal review (terms/privacy text are defaults) — neither has happened.
8. **External alerting/monitoring** and an on-call path.

## 13. High-priority fixes (after blockers)

- Reject `PATIENT` in `requireApiContext`; exclude Super Admin from clinical patient access/export or document it (M1, L1).
- Add CI (typecheck, lint, vitest, build, `npm audit`, `security:scan`) on every push; run the e2e suites on a Postgres service container.
- Investigate and stabilise the three flaky e2e checks (phases 12, 13).
- Decide on the Prisma tooling advisories (M8) and track them.
- Provide a real medicine/ICD/interaction source, or state clearly to clinics that these are absent; generate PDF prescriptions.
- Make `/ready` less revealing publicly (or require a token).
- Clarify audit-integrity wording in docs (M3); make audit write failures visible.
- Run the Phase 17 and Phase 18 suites and a Postgres performance pass; reconcile test counts in the reports (746 actual vs 742/745 reported).

## 14. Non-critical recommendations

Add scheduled-report generation (Phase 13) or hide the feature; patient merge; second template for the public site; barcode images; remove stale doc statements (`phase2-website.md:85`, `platform-admin.ts:59` strings); add a `platform/layout.tsx` guard for defence in depth; per-item draft/publish for website content; timestamp tolerance for Razorpay webhooks; delete the leftover `RESET_EMPTY_DATABASE`/`BOOTSTRAP_*` variables.

## 15. Evidence index

| Conclusion | Evidence |
|---|---|
| Code quality gates pass | commands 2–8, section 4 |
| Tests real and passing | vitest 746/746; e2e suites 1–16 (first run 3 transient failures, re-run clean) |
| Production live and healthy at HTTP level | live GET `/api/health` = ok; `/ready` = degraded (scheduler), database/migrations ok |
| Debug code in production | `src/app/layout.tsx:27-36`, commit `e954d08`, deployed in `12dc5aa` |
| No backups scheduled | `vercel.json` (only the communications cron); `docs/BACKUP_DR.md`; `scripts/backup.mjs` is manual |
| Providers unconfigured | live `/ready` JSON: payment/email/sms/whatsapp `not_configured`, `upload_scanner` `not_configured` |
| Rate limiter in-memory | `src/lib/security/rate-limit.ts:7-12`, no `setRateLimitStore` caller |
| Super Admin policy gap | `roles.ts:14`; `patient-crm.ts:44-48, 351-353` |
| `PATIENT` accepted by `requireApiContext` | `src/lib/auth/context.ts:209-214` |
| No CI | `.github/workflows` absent |
| Checklist unticked | `PRODUCTION_LAUNCH_CHECKLIST.md`: 36 unticked, 0 ticked |
| Dependency advisories | `npm audit` outputs (section 4, 6.8), `security-review/FINDINGS.md` #2 |

---

**Final classification: READY FOR STAGING. NOT READY FOR PRODUCTION** (and therefore not ready for a controlled production launch with real patients). Reason: functionality and automated verification are strong, but production-grade operations (backups and a proven restore, real communications, a scheduler that matches the product, distributed rate limiting, monitoring), the exposed admin credential and live debug code, and the absence of any independent security test mean the risk to real patient data is not yet acceptable.
