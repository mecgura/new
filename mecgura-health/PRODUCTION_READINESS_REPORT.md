# Production readiness report

**Overall: READY_WITH_WARNINGS** — the software is ready to deploy for a **controlled pilot** (a few clinics). Do **not** put real patient data in until blockers B1–B6 are closed. This is not a legal-compliance certification.

## Verified
Build, 742 unit/integration tests, 18 end-to-end suites (1,793 checks) on clean databases, security scan, route-guard test, data-integrity checks, axe accessibility, responsive checks, encrypted backup + restore (SQLite and PostgreSQL 16), health/readiness/version endpoints, production seed, environment gate, smoke test (`FINAL_QA_REPORT.md`).

## Blockers (non-code; must close before real patient data)
| # | Blocker | Owner action |
|---|---|---|
| B1 | No production infrastructure provisioned (managed PostgreSQL with TLS, encryption at rest, PITR; app host; wildcard DNS/TLS) | provision per `docs/DEPLOYMENT.md` |
| B2 | Restore drill not yet done on the production database; backup off-site copy and key custody not set up | run `backup` + `backup:verify`, record timings in `docs/BACKUP_DR.md` |
| B3 | No external alerting: uptime monitor on `/health`/`/ready` and an on-call channel must be created | set up; in-app alerts only reach Super Admins' bell |
| B4 | Legal: privacy policy/terms, data-protection roles, breach-notification duty, hosting-region decision | counsel + owner |
| B5 | Penetration test not performed | commission before scale |
| B6 | Any provider you want live (email/SMS/WhatsApp/Razorpay) is untested live — each needs sandbox test then keys | `docs/INTEGRATIONS.md` |

## Warnings
PostgreSQL: migrations and backup/restore verified, but the Vitest suite and benchmarks ran on SQLite only · rate limiter is per instance (needs shared store for >1 instance) · no column-level encryption of clinical fields · no malware scanner (images only) · no break-glass · TOTP only (no WebAuthn/SMS) · Chromium only · Compounder/Nurse/Staff roles not in the live sweep · Prisma CLI transitive advisories (tooling) · no CI pipeline committed.

## Integrations
Configured and working in this repo: in-app notifications, PostgreSQL/SQLite, backups. **NOT_CONFIGURED**: email (Resend), SMS (Twilio), WhatsApp (Meta), subscription payments (Razorpay), malware scanner, external error tracker, shared rate-limit store.

## Exact next action
Provision B1, set the variables, run `npm run env:check`, deploy per `docs/DEPLOYMENT.md`, run `db:seed:production`, `npm run smoke`, then walk `PRODUCTION_LAUNCH_CHECKLIST.md`.
