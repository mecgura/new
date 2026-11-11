# Security review — findings (Phase 16)

Severity: CRITICAL / HIGH / MEDIUM / LOW. Status: FIXED · MITIGATED · OPEN (remaining risk) · NOT_IMPLEMENTED.

| # | Finding | Sev | Module | Fix / status | Remaining risk |
|---|---|---|---|---|---|
| 1 | Next.js 16.3.4 had critical/high advisories (RCE in `next/og`, SSRF in image optimisation, cache poisoning) | CRITICAL | dependency | **FIXED** — upgraded to 16.4.0 (pinned) | none known; re-run `npm run security:audit` each release |
| 2 | Prisma CLI transitive advisories (`@prisma/config`, `deepmerge-ts`, `mysql2` via dev tooling) | HIGH (tooling) | dependency | **OPEN** — only the migration/seed CLI is affected, not the request path; the fix is a semver-major downgrade of the CLI | keep the CLI out of the runtime image where possible; run migrations from CI |
| 3 | No second factor for any staff account | HIGH | auth | **FIXED** — TOTP (RFC 6238) + backup codes, enforced in `authorize()`, required-by-role policy, step-up | SMS/email OTP not offered (no verified provider) |
| 4 | No staff password change / self-service reset | MEDIUM | auth | **FIXED** — change (needs current pw + code), emailed single-use hashed token (30 min), generic responses, APP_URL-based links | reset email is sent only when an email provider is configured |
| 5 | No way to end a staff user's other sessions | MEDIUM | session | **FIXED** — `sessionsValidFrom` checked on every request | — |
| 6 | Audit rows could be edited/deleted undetectably | HIGH | audit | **FIXED** — per-row HMAC, DB trigger blocks UPDATE, seals detect deletions, purge restricted (retention + password + legal-hold aware) | an attacker with DB **and** key access could re-sign; keep `SECURITY_KEYS` in a secrets manager |
| 7 | Signing/encryption keys default to a value derived from `AUTH_SECRET` | MEDIUM | secrets | **MITIGATED** — `SECURITY_KEYS` ring with rotation supported; Security Center warns when derived | set `SECURITY_KEYS` in production |
| 8 | No API key system | — | api | **IMPLEMENTED** safely (hash only, scopes, expiry, IPs, rotation, audit, events) | scopes are read-only today |
| 9 | No central security monitoring / incident record | MEDIUM | monitoring | **IMPLEMENTED** — events, detections, alerts, incidents | alerts are in-app only; external paging needs a provider |
| 10 | Rate limiter is in-process memory | MEDIUM | api | **OPEN** — interface allows a Redis store (`setRateLimitStore`) | with several app instances limits are per instance |
| 11 | Exports not individually monitored | LOW | privacy | **FIXED** — every export raises an event; 8/hour flags review | — |
| 12 | Data-rights requests had no workflow / due dates | MEDIUM | privacy | **FIXED** — 6 request kinds, 30-day due date, outcomes, no silent erasure | anonymisation of clinical data is intentionally not automated |
| 13 | Consent lacked source/IP/purpose; marketing not separable | MEDIUM | privacy | **FIXED** — per-type, per-purpose, versioned, append-only | marketing messaging itself does not exist yet |
| 14 | Application-level encryption of patient records | MEDIUM | data | **NOT_IMPLEMENTED** — rely on database/volume encryption (infrastructure) | enable encryption at rest at the hosting layer; verify in launch checklist |
| 15 | Malware scanning of uploads | LOW | files | **MITIGATED** — only sniffed images accepted; scanner interface fails closed once registered | no scanner bundled |
| 16 | Break-glass emergency access | — | access | **NOT_IMPLEMENTED** — support access (reasoned, 1 h, banner, audited) is the only elevated path | — |
| 17 | CSP allows inline *styles* | LOW | headers | **ACCEPTED** — scripts remain nonce-only; styles are needed for theme variables | — |
| 18 | Client-supplied `tenantId` (query/body) | HIGH if trusted | tenancy | **VERIFIED SAFE** — ignored everywhere; e2e proves it | — |
| 19 | Foreign-object probing by ID | HIGH if broken | tenancy | **VERIFIED SAFE** — 404/403 across probed modules; per-module e2e (phases 3–14) cover the rest | — |
| 20 | Open redirect after sign-in | MEDIUM | auth | **VERIFIED SAFE** — `safeRedirectPath` | — |
