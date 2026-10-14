# Security

Compliance-**ready controls**, not a certification. Nothing here claims HIPAA/GDPR/DPDP or any other legal compliance; that needs an organisational process and legal review that this software alone cannot provide. Full review: `security-review/ARCHITECTURE.md` and `security-review/FINDINGS.md` (20 findings with severity, module, fix and remaining risk).

## Controls in place
| Area | Control |
|---|---|
| Tenant isolation | Server-derived tenant, `tenantDb` auto-scoping, registry test, 404 on foreign ids (`docs/TENANCY.md`) |
| Authentication | bcrypt (cost 12), generic errors, per-IP and per-account throttles, lock-out, TOTP MFA + recovery codes, MFA required by role policy, single-use hashed reset tokens (30 min), `sessionsValidFrom` kills all sessions on password change/MFA reset, 4 h platform / 8 h staff sessions |
| Authorization | role + permission + feature gate + ownership, non-grantable permissions, step-up for platform and API-key actions (`docs/AUTHORIZATION.md`) |
| Transport/headers | HTTPS (HSTS 2 years, preload), CSP with per-request nonce for scripts, `frame-ancestors 'none'`, nosniff, strict referrer policy, restrictive permissions policy, COOP, no `X-Powered-By` |
| CSRF / CORS | same-origin check on every state-changing API call; no permissive CORS |
| Input | Zod schemas on every API body/query; output escaping by React; website rich text restricted markdown, `javascript:` links neutralised |
| Files | images only (content-sniffed), size caps, stored in the database, served with `nosniff`; avatars need a same-clinic session; scanner interface fails closed once a scanner is registered |
| Audit | every sensitive action; ids/counts only; per-row HMAC; append-only DB trigger; periodic seals detect deletions; retention policy + legal hold; purge restricted |
| Secrets | none in the repo (`npm run security:scan`); `SECURITY_KEYS` ring with rotation; MFA secrets AES-256-GCM; API keys/reset tokens hashed; logs redact sensitive keys |
| Privacy | consent register (append-only, per purpose), 6 data-rights request kinds with 30-day due dates (erasure can never be silently "fulfilled" for clinical records), export events monitored, masking by permission |
| API keys | scoped (read-only today), hashed, expiring, optional IP allow-list, revocable, usage audited |
| Monitoring | Security Center: events, detections (brute-force, sign-in after failures, account lock, repeated authorisation denials, unusual export volume, webhook signature failures, audit-integrity failure, scheduler stale, job failures), alerts to Super Admins' bell, incident records with timeline |
| Rate limiting | sign-in, public forms, readiness, per-user API reads/writes |
| Backups | encrypted (AES-256-GCM), checksummed, restore-verified (`docs/BACKUP_DR.md`) |

## Known limitations (be upfront with clients)
1. **No column-level encryption of patient records** — rely on the host's encryption at rest + TLS to the database.
2. **Rate limiter**: in production the counters live in the database (`RateLimitBucket`, `DbStore` in `src/lib/security/rate-limit.ts`), so limits — including the two-factor code limit — hold across serverless instances. Set `RATE_LIMIT_STORE=memory` to force the per-instance store; if the database is unreachable a hit falls back to per-instance counting. Expired counters are pruned by the scheduled job. A Redis store can still be plugged in with `setRateLimitStore`.
3. **No bundled malware scanner** — images only; register a scanner before allowing documents.
4. **Alerts are in-app only** — no e-mail/SMS/pager alerting is built in.
5. **No break-glass access**; support access is reasoned, time-boxed (60 min) and audited.
6. **Prisma CLI transitive advisories** (migration/seed tooling only, not the request path) — re-check `npm run security:audit` at each release.
7. **MFA factors**: TOTP and recovery codes only (no SMS/e-mail OTP, no WebAuthn).
8. **No independent penetration test** has been performed. Commission one before onboarding real patients at scale.

## Operating the controls
- Weekly: Platform → Security (events, open incidents, key/API-key expiry), `npm run security:audit`.
- Monthly: rotate nothing automatically — rotate `SECURITY_KEYS` by *adding* a new first key (keep the old ones), review who has Super Admin / Clinic Admin, review API keys.
- Each release: `npm run security:scan`, `npm test` (includes tenancy, audit-integrity and route-guard tests), dependency audit.
- Audit integrity: Platform → Security → Audit → Verify (also sealed daily by the scheduler job `audit-seal`).
