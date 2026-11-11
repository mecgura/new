# Incident response

Applies to security incidents (suspected breach, data exposure, account takeover) and operational incidents (outage, data loss, wrong data). The product keeps the evidence; people make the decisions.

## Severity
| Level | Meaning | First response | Update cadence |
|---|---|---|---|
| SEV1 | Patient data exposed or possibly exposed; platform down for all clinics; data loss | immediately, page the owner | every 30 min |
| SEV2 | One clinic down/degraded; payments or messaging wrongly processed; MFA/auth bypass suspected | within 1 h | every 2 h |
| SEV3 | Single-user issue, provider degraded, job failures with no data impact | same business day | daily |

## Roles (assign real names before launch)
Incident lead (decides, communicates) · Technical lead (investigates/fixes) · Communications (clinics/patients) · Scribe (timeline). One person may hold several roles in a small team.

## Steps
1. **Detect** — uptime monitor on `/health` `/ready`, Security Center alert (bell), System health warning, clinic report, support ticket.
2. **Open a record** — Platform → Security → Incidents → *New incident* (severity, summary, affected clinic(s)). Everything below is added to its timeline; do not put patient details in it (ids only).
3. **Contain** — typical levers:
   - one account: deactivate user / *log out everywhere* / reset MFA (all audited)
   - one clinic: suspend clinic (re-authentication + reason)
   - API key: revoke (Security → API keys)
   - provider abuse: remove the provider variables and redeploy (channel becomes *not configured*)
   - whole platform: maintenance mode (Super Admins keep access) or scale the app to zero
4. **Preserve evidence** — do not delete anything. Export the relevant audit range; run **Audit → Verify** (hash chain + seals); place a **legal hold** on the affected clinic/audit range so retention cannot purge it; take a backup (`npm run backup`) before any repair.
5. **Eradicate & recover** — rotate secrets (`AUTH_SECRET` signs out everyone; add a new first entry to `SECURITY_KEYS`; provider keys; `CRON_SECRET`; API keys), patch, restore from a verified backup if data was lost (`docs/BACKUP_DR.md`), confirm with `npm run smoke`, `/ready`, `npm run qa:integrity`.
6. **Notify** — your legal counsel decides whether and when regulators and patients must be told; many jurisdictions set short deadlines from awareness. The product gives you the data-rights/consent registers and audit evidence; it does not decide legal duty. Notify affected clinics (they are usually the data controllers) promptly with: what happened, what data, what you did, what they should do.
7. **Close** — resolve the incident record with root cause; open follow-up work; update runbooks.
8. **Review** within 5 working days: timeline, detection gap, what would have prevented it, owners and dates.

## Quick runbooks
- **Suspected account takeover**: deactivate → log out everywhere → reset MFA after identity verification → review that user's audit trail and exports → force password reset.
- **Cross-tenant exposure suspected**: SEV1. Identify the route from audit/ErrorEvent, disable the clinic feature or route, preserve evidence, run `npm run qa:integrity` (cross-tenant FK check), add a regression test before re-enabling.
- **Audit integrity failure**: SEV1/2. Stop purges, compare to last seal, check that all historical `SECURITY_KEYS` entries are still present (a missing old key looks like tampering), investigate DB access logs at the provider.
- **Provider sending wrong/duplicate messages**: remove provider variables (channel stops), review Communications log, notify affected clinics.
- **Backup/restore failure**: see `docs/BACKUP_DR.md`; a failed `backup:verify` is SEV2 until a good restore test exists.

## Contacts (fill in before launch)
Owner/on-call · Hosting provider support · Database provider support · Domain/DNS provider · Payment provider · Legal counsel · Clinic escalation contacts.
