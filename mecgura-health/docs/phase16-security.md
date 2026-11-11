# Phase 16 — Security, privacy & compliance (implementation notes)

See `security-review/` for the architecture and the findings register.

**Built:** TOTP two-factor (+ backup codes, role policy, step-up) · password change / emailed reset · sign-out-everywhere · tamper-evident audit (HMAC + seals + DB trigger + verify + restricted purge) · security events, detections and alerts · incident register · access review · API keys + `/api/v1` · consent register · data-rights workflow · legal holds · classification, signed-URL and scanner interfaces · `npm run security:scan` / `security:audit` · Next.js security upgrade.

**Honest limits:** not a certification; DPDP/other duties still need the clinic's legal review. No break-glass access. No column-level encryption of patient data (use encrypted storage). In-memory rate limiting. Alerts are in-app only. Prisma CLI advisories remain (tooling only).

**Operate it:** set `SECURITY_KEYS`; decide MFA-required roles under *Platform → Security → Access & policy*; run *Seal* regularly and *Verify* after any incident; keep audit retention OFF unless counsel sets a period.
