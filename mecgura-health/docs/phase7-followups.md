# Phase 7 — Follow-up CRM, recalls and reminders

A **clinic** follow-up system (not a sales CRM): make sure no important patient follow-up is missed. It reuses Patient, Doctor, Appointment (Phase 3 engine), Consultation/Prescription (Phase 5), Lab reports (Phase 6), Notifications and Audit. Nothing is sent to patients; nothing makes a medical decision.

## Workflow
```
Consultation plan / prescription / lab report / manual / no-show / cancellation / recall
        → FollowUp FU-2026-000001 (PENDING → DUE when the date arrives)
        → staff take it (IN_PROGRESS) → log contacts (manual) → book via the existing appointment engine (APPOINTMENT_BOOKED)
        → visit happens → staff close it with an outcome + notes (COMPLETED) [optional clinic rule closes it automatically]
```
* **Overdue** is computed from the due date (never stored). `DUE` is set lazily when lists/stats load.
* A logged contact **never completes** a follow-up; a manual "appointment booked" note is not a booking. Only a real appointment created through the follow-up moves it to `APPOINTMENT_BOOKED` (the link is validated *before* the appointment is created).
* If the booked visit is cancelled or missed, the follow-up is re-opened (no extra follow-up is spawned).
* Reschedules keep history (from / to / reason / who). All events are append-only (`FollowUpEvent`, `FollowUpContact`).

## Where follow-ups come from (all explicit)
| Source | Rule |
| --- | --- |
| Consultation | Doctor's own "follow-up required" plan becomes ONE follow-up on finalize; an amendment updates it (never duplicates); removing the plan cancels the open one |
| Prescription / lab report / doctor order | Doctor clicks "create follow-up"; patient, doctor and links come from the record on the server, never from the client. Report must be released. Never automatic |
| Manual | Reception/doctor/admin, patient chosen by search |
| No-show | Clinic rule, **default ON** (one task, deduped); contact-only bookings (no patient record) are skipped |
| Cancellation | Clinic rule, **default OFF** |
| Recall | Staff click "create follow-up", or clinic rule "recall creates follow-up" (default OFF) |

Rules live in `/settings/followups` (clinic admin only, audited). Custom contact/completion outcomes can be added there.

## Roles
Doctor: own patients' follow-ups (own, assigned, created), create from clinical records, complete clinical types. Reception: unassigned + assigned to them; contact, book, reschedule, complete operational types; no doctor notes or clinical links. Nurse: assigned only, can log contact. Clinic admin: all + rules. Lab/accountant/platform admin: none. Clinical types (report review, medication review, procedure) can only be closed by clinical access.

## Recalls
A recall is a planned reminder (title, due date, frequency, bounded `maxOccurrences` ≤ 12). The next occurrence is created only on "Complete & schedule next" and never beyond the limit — no unlimited future rows.

## Reminders / notifications
`syncReminders` creates in-app notifications lazily (once per kind per user per day, only if count > 0): FOLLOW_UP_DUE, FOLLOW_UP_OVERDUE, RECALL_DUE, REPORT_REVIEW. No SMS/WhatsApp/email. Notification text contains counts only, never patient names. These kinds are the hook for the Phase 10 communication channels.

## Communication preferences
Phase 4 preferences are respected: logging a contact by a method the patient marked "not allowed" is refused. WhatsApp/SMS/Email are only **manual logs** ("integration not configured"). Preference changes are audited (`patient.communication_preference_changed`).

## Data / routes / API
Tables: `FollowUp`, `FollowUpContact`, `FollowUpEvent`, `Recall`, `FollowUpSettings` (all tenant-scoped; `@@unique([tenantId, followUpNumber])`, `@@unique([tenantId, dedupeKey])`; indexes on tenant+status+dueDate, assignee, doctor, patient). Migrations `20261007082513_phase7_followups` (SQLite) and `20261008090000_phase7_followups` (PostgreSQL).
Pages: `/followups` (command center: cards, tabs, filters, recalls, mobile cards), `/followups/[id]`, `/settings/followups`, Patient 360 "Follow-up" tab + timeline filter, consultation "Follow-ups" tab, dashboard section.
API: `/api/followups` (+ `stats`, `settings`, `assignees`, `[id]`, `[id]/action`, `[id]/contact`), `/api/recalls` (+ `[id]/action`), `/api/patients/[id]/followups`.

## Known limitations
* Route is `/followups` (the existing navigation entry), not `/dashboard/follow-ups`.
* No automatic messaging of any kind; contact logs are manual. `EXPIRED` status is reserved (nothing expires automatically).
* Appointment completion is reconciled lazily when the follow-up screens load, not by a background job.
* No patient portal, billing, analytics dashboards or AI (later phases). Retention numbers are plain operational counts.
* Contact-only appointments (no patient record) can't create a no-show follow-up.
