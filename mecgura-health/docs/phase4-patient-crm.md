# Phase 4 — Patient CRM, digital medical file, Patient 360

## Architecture
* **Extended, not duplicated.** Phase 3 already had a minimal `Patient` (identity only) used by appointments and OPD. Phase 4 extends that same table (`code` = Patient ID, `name`, phone, DOB…) and adds child tables. `Appointment.patientId` / `OpdVisit.patientId` are the links; there is no second appointment/visit history.
* **Name** stays one field (`name`, plus optional `preferredName`) because Phase 3 flows depend on it.
* **Patient ID** `P-000042`: per-clinic atomic counter, never reused (archived IDs stay taken), not derived from phone or medical data.
* **Tables:** `Patient` (+ address, emergency contact, blood group, status/archive, contact preferences, family link), `PatientAllergy`, `PatientMedication` (summary only), `PatientHistory`, `PatientFamilyHistory`, `PatientNote`, `PatientConsent` (append-only), `FamilyGroup`. All are in `TENANT_SCOPED_MODELS`.
* **Services:** `lib/services/patient-crm.ts` (list, profile, register, edit, status, archive/restore, visits, appointments, timeline, export), `patient-records.ts` (clinical records, notes, consent, family), `patients.ts` (Phase 3 search/verify/duplicates, now archived-aware).

## Access tiers (server-side, per section)
| Tier | Permission | Sees |
|---|---|---|
| identity | `patients.identity` | name + patient ID only (accountant, lab staff) |
| view | `patients.view` | demographics, contact, visits, appointments, non-clinical notes, consent, family |
| clinical | `patients.clinical` | allergies, history, medicines summary, family history, clinical notes (doctor, nurse, admin) |
| write | `patients.create` / `edit` / `clinical_edit` | reception registers and edits demographics; doctors/nurses write clinical records |
| admin | `patients.archive`, `patients.export` | archive/restore, export (non-grantable) |

Another clinic's patient answers `NOT_FOUND` everywhere (profile, timeline, records, family, search, list, duplicate check, export, Phase 3 patient references). Record ids are always matched together with the patient id and tenant.

## Timeline
Built from real data only: registration, appointments (booked / checked in / cancelled / no-show), OPD token events (token, called, started, completed), clinical record creation (clinical roles), and audited patient-file changes (updated / archived / restored / consent). Filters: all, appointments, OPD, clinical; documents / reports / billing / follow-up are visibly "soon". Paginated (20/page). Future modules add event sources.

## Privacy rules
* No hard delete; archive needs `patients.archive`, refuses while the patient is queued or has upcoming appointments, and makes the file read-only; restore is admin-only. All audited.
* Audit rows hold ids, field **names** and enum values — never note text, allergen/medicine/history titles, phone numbers or the archive reason.
* Lists and search return masked phones; full contact only on the profile for `patients.view`.
* Duplicate detection (mobile, alternate mobile, email, name + DOB) needs explicit confirmation; nothing is merged. **Merge is not implemented** (future: admin-only, preview, audited, same-tenant).
* Consent is an append-only log with a clinic-supplied version label. The UI states that the clinic remains responsible for its notice and any further legal consent.
* Communication preferences are stored, nothing is sent (Phase 12).
* Family grouping never shares or merges records. The relationship is a foundation for the future patient portal (Phase 11), which must still authorise per patient.
* Export is a POST (CSRF-checked) generated per request and returned to the browser — no stored file, no URL.
* The system never diagnoses, infers allergies/conditions or recommends medicines; medicines are a record, not a prescription.

## Phase 3 connections
Profile shows today's token + live status, next appointment, last visit, total visits. OPD board names and the appointment detail link to the patient file. Quick actions from the profile: New appointment (preset patient) and New OPD visit use a server-checked `{patientId, viaProfile:true}` reference (needs `patients.view`; archived patients are refused).

## Not built (by design)
Consultation, prescriptions, tests/reports workflow, billing, inventory, patient portal, WhatsApp automation, analytics, patient photo, documents upload, automatic merge.

## Phase 5 starting point
Consultation hangs off `OpdVisit` (patient, doctor, token, appointment, timestamps and `IN_CONSULTATION → COMPLETED` exist). Open the patient file from the doctor's current queue entry (link exists), add a `consultation` event source to `patientTimeline`, and enable the `consultations` / `prescriptions` modules. The medicines summary and allergy records are the read-only context for the prescribing screen.
