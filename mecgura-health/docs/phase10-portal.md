# Phase 10 — Patient portal and patient login

A separate, read-mostly area (`/portal/*`) where a clinic's patients sign in to see **their own** appointments, token, records, documents and bills. It is white-labelled per clinic (colours/name/logo) and never indexed.

## Identity model (never trust the browser)
`session → User(role PATIENT) → PatientAccount → Patient → Tenant`. The patient id, account id and clinic id are **only** derived on the server (`src/lib/portal/ctx.ts`, one cached lookup per request). No API takes a patient id or tenant id from the client; every query is `tenantDb(ctx)` **plus** `patientId = ctx.patientId`. Appointments appear under their `publicId`; doctors are shown by an HMAC handle, never a staff user id.

Every request re-reads the account, so these take effect immediately: suspended/deactivated account, archived patient, portal switched off, "log out everywhere" (`PatientAccount.sessionsValidFrom`), password change. A patient session is also capped at 4 h absolute (`pexp`), regardless of activity.

## Login and activation
* Separate Auth.js `patient` Credentials provider. A staff account cannot sign in there and a patient cannot sign in at `/login`. A patient can't reach staff pages (`requireContext` sends PATIENT to `/portal`) or staff APIs (permission set is empty).
* Clinic is chosen by **host** (subdomain / verified custom domain) first; `?clinic=slug` is used only on a host with no clinic. A clinic-A patient cannot sign in on clinic B's host.
* Activation: reception/admin (`portal.manage`) issues a one-time code `XXXXX-XXXXX` (72 h, shown once, stored HMAC-hashed, a new code revokes the old). The patient must also give the mobile/email the clinic has on file. 5 wrong identity attempts revoke the code. Creates the User + PatientAccount + PRIVACY consent in one transaction. A second code on an active account is an `ACCESS_RESET` (new password, all sessions ended).
* 5 failed passwords → 15-minute lock; generic error (no enumeration, constant-time dummy compare); IP + account rate limits. Failures are audited with a reason code.

## Portal features
Dashboard · appointments (book from the real Phase 3 slot engine, cancel/reschedule inside the clinic policy, max 5 upcoming) · live OPD token (own token only, polling every 15 s with a stale/offline state — not real-time push) · consultation history (complaints, advice, follow-up plan; **never** history/examination/assessment/notes; diagnoses only if the clinic enables it) · finalized prescriptions (from the immutable version) · released lab reports (`RELEASED`/`AMENDED` only) · follow-ups (status translated, staff-only statuses hidden) · bills / payments / receipts · documents (HTML print → Save as PDF, ownership re-checked and audited) · profile (only clinic-configured editable fields) + correction requests · communication preferences (only in-app is active) · privacy & consent (versioned history) · security centre (change password, log out everywhere) · notifications (in-app, created lazily from real records, de-duplicated) · timeline · support page · account-deactivation request.

## Staff side
* `portal.manage` (RECEPTIONIST, CLINIC_ADMIN): issue code / reset access / suspend / restore on the patient's Overview tab; review **Portal requests** (`/patients/requests`: start → approve/reject → apply a profile correction, which needs `patients.edit`).
* `portal.configure` (CLINIC_ADMIN only): `/settings/portal` — enable portal, booking, cancel, reschedule, cutoff hours, diagnoses visibility, editable fields, privacy notice, support note.
* Patient logins never appear in the team/users screens.

## Data
New tables `PatientAccount`, `PatientInvite`, `PatientRequest`, `PortalSettings`; `Notification.dedupeKey`. Migration `20261011090000_phase10_patient_portal` (SQLite and PostgreSQL). Appointment source `PORTAL`.

## Security summary
CSRF same-origin check on every patient write; `Cache-Control: private, no-store` + `X-Robots-Tag: noindex` on all `/portal/*`; DTO-only responses; audit of logins, bookings, cancellations, document views/downloads, preference/consent/security changes (ids only — no passwords, codes or medical text).

## Not built / needs configuration
* **No OTP / SMS / WhatsApp / email provider** — `src/lib/integrations/otp.ts` is an unconfigured abstraction; activation is clinic-issued code + identity match. Preferences record the patient's choice but nothing is sent.
* **No payment gateway** — `src/lib/integrations/payment-gateway.ts` is unconfigured; the portal says "Online payment isn't available yet. Please pay at the clinic."
* Documents are print-to-PDF HTML; there is no patient upload store.
* No family/dependent accounts (one account = one patient).
* JWT sessions can't be revoked one by one — only all at once (`sessionsValidFrom`) or by the 4 h cap.
* Notifications appear when the patient visits; there is no push. Communication automation is Phase 11.

## Tests
`src/lib/services/portal.integration.test.ts` (44 tests: RBAC, activation, lockout, sessions, booking policy, privacy of DTOs, tenant isolation, IDOR matrix, audit hygiene) and `e2e/phase10-portal.mjs` (137 live checks on a production build incl. white-label host via a second server with `TENANT_ROOT_DOMAIN=mh.test`).
