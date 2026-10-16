# Phase 5 — Doctor consultation, vitals, diagnosis, prescription, orders

## Inspection summary (what was reused)
Reused Phase 3 `OpdVisit` (queue, token, status machine), Appointment, Phase 4 `Patient` + allergies/medicines/timeline, `tenantDb`, `apiRoute`, audit, RBAC, `TenantCounter`, the design system and `usePolling`. No second patient/doctor/visit/appointment/audit model was created. There was no print centre in Phase 3, so the prescription document is the first one (clinic-branded, authenticated). No AI service, medicine database, diagnosis terminology or interaction source exists in the project, so none is simulated.

## Model
`Consultation` (1:1 with `OpdVisit`, unique; optional appointment) · `ConsultationVersion` (immutable snapshot + sha-256 per finalization) · `ConsultationVitals` · `ConsultationDiagnosis` · `Prescription` (1:1 with consultation) · `PrescriptionItem` (working copy) · `PrescriptionVersion` (immutable snapshot + hash) · `DoctorOrder` · `ConsultationTemplate` · `MedicineReference` (the clinic's own list — empty by default). All tenant-scoped (`TENANT_SCOPED_MODELS`). Numbers: `CONS-YYYY-NNNNNN` and `RX-YYYY-NNNNNN` from atomic per-clinic counters, unique per tenant (`@@unique([tenantId, number])`).

## Rules enforced on the server
* **Who writes:** only the treating doctor (role DOCTOR and `doctorUserId` match) edits clinical content, finalizes, amends, creates orders. Nurses may add vitals. Other doctors, nurses and admins may read (`consultation.view` + `patients.clinical`). Receptionist, compounder, accountant, lab and **platform admins** have no access to consultations.
* **States:** IN_PROGRESS → READY_FOR_REVIEW → FINALIZED (DRAFT/CANCELLED exist). Editing a "ready" consultation sends it back to in-progress. Finalizing needs the review state and an explicit confirmation.
* **Immutability:** after FINALIZED every edit path (notes, vitals, diagnosis, prescription, cancel) answers 409. A correction is **Amend** with a reason → editing reopens → finalizing writes version n+1; earlier versions and hashes stay.
* **Concurrency:** one consultation per visit (unique `opdVisitId`, idempotent start); finalize is a guarded `updateMany` inside a transaction (double submit → exactly one version, also for the prescription); autosave uses a `rev` counter so a stale tab can't overwrite newer text.
* **Live OPD:** "Start consultation" calls the existing queue actions (call → start, one patient with the doctor at a time still applies). Finalizing completes the visit through the normal queue rules.
* **Prescription:** DRAFT → REVIEW → FINALIZED, doctor confirmation required. First finalization assigns the Rx number; amendments keep the number and add a version. Medicines are typed or picked by the doctor; the system never suggests, checks or alters medicine, dose or duration. Orders never read or write prescriptions.
* **Documents:** finalized snapshot + the clinic's *current* branding (name, logo, address, phone, colour, doctor qualification/registration). Served only to authenticated `prescription.print` users of that clinic (page + attachment download), `no-store`, escaped, audited (print/download). No public URL, no MECGURA branding.
* **No invented data:** with no medicine source, search answers "No medicine database configured" and the doctor types manually; diagnoses are manual (code optional); templates are empty headings; allergy information is displayed but never used to judge a medicine.
* **Audit:** ids, field names, counts and enums only — never note, diagnosis, medicine, order text or vitals values (tested).

## Integrations (interfaces only)
`lib/integrations/medicines.ts`: `MedicineSource`, `DiagnosisSource`, `SafetyCheckSource` — all `null`. Hook points for e-prescription/pharmacy, lab and billing are the order types and the immutable prescription snapshot; nothing is built.

## Not built (later phases)
Lab/reports workflow, billing, inventory/pharmacy, patient portal, WhatsApp/SMS/email, follow-up CRM (only the doctor's instruction is stored), analytics, AI assistance, consultation summary/OPD-slip printing, medicine-list import UI (API exists: `POST /api/medicines`, admin).

## Run the checks
```bash
npm run lint && npm run typecheck && npm run db:check-schema && npm test
NEXT_DIST_DIR=.next-prod npm run build && NEXT_DIST_DIR=.next-prod npx next start -p 3101
npm run db:seed && node e2e/phase5-consultation.mjs   # also phase1–4 scripts
```
