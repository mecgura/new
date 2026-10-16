# MECGURA HEALTH — security architecture (as implemented)

Defence in depth. Nothing the browser says about identity, role, permission or clinic is trusted.

| Layer | Control | Where |
|---|---|---|
| Identity | bcrypt (cost 12) passwords; lockout after 5 failures (15 min); per-IP + per-account throttles; optional TOTP second factor enforced inside `authorize()`; staff and patient sign-in are separate providers | `src/auth.ts`, `app/actions/auth.ts`, `sec-mfa.ts` |
| Session | JWT carries only the user id; role, tenant, status, permissions are re-read from the DB on **every request**; 8 h lifetime (4 h for Super Admin); `sessionsValidFrom` kills older sessions (password change/reset, “sign out everywhere”, MFA reset) | `lib/auth/context.ts`, `sec-account.ts` |
| Tenant context | derived server-side from the session user's membership; `tenantDb(ctx)` injects `tenantId` into every query of every tenant-owned model (registry test fails the build if a model is unregistered) | `lib/tenant/*` |
| Authorization | `apiRoute` → CSRF same-origin → auth → permission → service-level resource checks; permissions are granular (`patients.view`, `billing.refund_approve`, `security.manage` …); admin powers are non-grantable | `lib/api/handler.ts`, `lib/permissions/*` |
| Field level | clinical / identity tiers (`patients.clinical`, `patients.identity`) and read-only mode strip write permissions | `permissions/constants.ts`, `auth/context.ts` |
| Step-up | password re-entry (+ authenticator code when enabled) for money, security, support-access and API-key actions | `platform-core.ts` (`reauth`/`stepUp`) |
| Audit | every sensitive action recorded (ids/counts only, redacted); each row HMAC-signed with a key kept outside the DB; DB trigger refuses edits; seals pin ranges so deletions are detectable; verification UI | `lib/audit`, `sec-audit.ts` |
| Monitoring | `SecurityEvent` stream (failed logins, brute force, lockouts, authz denials, webhook signature failures, API-key abuse, exports, support access, config changes), HIGH/CRITICAL raise in-app alerts; incident register | `sec-events.ts`, `sec-center.ts` |
| Secrets | none in source; env only; `security:scan` fails on committed secrets; MFA secrets AES-256-GCM with a rotatable key ring (`SECURITY_KEYS`) | `lib/security/crypto.ts` |
| Transport/headers | nonce CSP (`frame-ancestors 'none'`, `object-src 'none'`), HSTS, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP; no CORS headers | `next.config.ts`, `proxy.ts`, `csp.ts` |
| Webhooks | raw-body signature verification, size caps, event-id replay protection, provider re-verification for payments, failures logged as security events | `sub-webhooks.ts`, `communications/webhooks.ts` |
| API keys | hashed, scoped, expiring, IP-restrictable, revocable/rotatable, read-only `/api/v1`, per-key + per-IP rate limits, cookies ignored | `sec-apikeys.ts`, `api/key-route.ts` |
| Privacy | consent register (versioned, per type/purpose, never edited), data-rights workflow (30-day due date), erasure can never silently delete clinical records, legal holds | `sec-privacy.ts`, `sec-audit.ts` |
| Files | only images are accepted (type sniffed from bytes, size capped); no patient file storage exists — documents are generated per request behind auth; signed-URL + scanner interfaces ready for future storage | `uploads.ts`, `signed-url.ts`, `malware.ts` |
