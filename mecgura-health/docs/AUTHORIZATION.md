# Authorization

Every protected action verifies, in this order: **authentication → tenant → role → permission → resource ownership**. Failing any step returns 401/403/404 without data.

## Layers
1. **Session** (Auth.js JWT, httpOnly+SameSite cookie). Each request re-reads the user: inactive/locked/deleted users, clinic status and `sessionsValidFrom` (log-out-everywhere, password change, MFA reset) end the session at once. Platform sessions last 4 h, clinic staff 8 h.
2. **Roles** (code-defined, 12): SUPER_ADMIN, CLINIC_ADMIN, DOCTOR, RECEPTIONIST, COMPOUNDER, NURSE, LAB_STAFF, ACCOUNTANT, PHARMACY_STAFF, PHARMACY_MANAGER, STAFF, PATIENT. There is no run-time role editor on purpose.
3. **Permissions** (122, `module.action`): role defaults + per-user grants. Some are **non-grantable** (`platform.manage`, `security.manage`, `privacy.manage`, `apikeys.manage`, …) and can never be given to a custom user.
4. **Feature/plan gates**: a clinic's disabled feature or blocked subscription removes the related permissions in `getAccess()` — so pages, APIs and services all deny it.
5. **Ownership**: doctors see their own consultations/orders unless granted wider; patients see only their own records through `/api/patient/*` and `src/lib/portal`.
6. **Field level**: patient contact/identity, clinical, financial and export permissions are separate (`patients.identity`, `patients.clinical`, `analytics.export_patient`, …); lists mask what the caller may not see.
7. **Step-up** (`reauth()`: password again, plus an authenticator code when MFA is on): platform actions (clinic suspend/deactivate/archive/restore, feature switch-off, clinic-admin change, user deactivation, role change, access reset, maintenance, domain changes, support access) and API-key creation/revocation. Billing refunds and discounts are controlled by permissions and approval roles (request vs approve vs process), **not** by password re-entry.
8. **MFA**: TOTP (RFC 6238, replay-protected) + recovery codes; per-role requirement set by policy (production seed turns it on for SUPER_ADMIN).

## Role summary (permission counts from `ROLE_PERMISSIONS`)
| Role | Perms | In short |
|---|---:|---|
| SUPER_ADMIN | 122 | Platform console; clinic data only through audited support access |
| CLINIC_ADMIN | 121 | Everything inside own clinic except platform |
| DOCTOR | 50 | Own consultations, prescriptions, orders, patients' clinical view, follow-ups, own analytics |
| RECEPTIONIST | 34 | Patients, appointments, OPD queue, billing desk (collect, discount, request refund), follow-up calls |
| NURSE | 24 | Vitals/records, sample collection, follow-up contact |
| ACCOUNTANT | 19 | Billing, refunds processing, financial reports/exports |
| PHARMACY_MANAGER | 19 | Stock, purchases, suppliers, adjustments, return approval, pharmacy reports |
| COMPOUNDER | 16 | OPD queue support, vitals entry, prescription view/print |
| LAB_STAFF | 15 | Lab orders, collection, results entry (review only with the extra `lab.review`-style grant) |
| PHARMACY_STAFF | 8 | Dispense, return request, stock view |
| STAFF | 3 | Dashboard only (extend with grants) |
| PATIENT | 0 staff permissions | Own portal only |

## Verification
- `permissions` unit tests (role matrix, non-grantable set), `security.integration.test.ts` (grant rules), `e2e/phase18-qa.mjs` (8 roles × 92 pages: no 5xx, clinic roles never reach `/platform`, non-admins cannot open Team/security settings) and the per-phase e2e role checks.
- `src/lib/api/route-guards.test.ts` fails the test-suite if any of the 339 route files has no authentication primitive and is not on a short reviewed public list (health, ready, version, Auth.js, scheduler, provider webhooks, public robots/sitemap), or if a route reads the clinic from the request.
