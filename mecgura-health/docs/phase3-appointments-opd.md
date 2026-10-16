# Phase 3 — Appointment engine, calendar, live OPD & tokens

## What exists
| Area | Where |
|---|---|
| Availability, slots, blocked time | `lib/scheduling/availability.ts` (pure), `lib/services/availability.ts` (DB) |
| Appointments (create / confirm / reschedule / cancel / no-show / check-in) | `lib/services/appointments.ts`, `appointment-core.ts` |
| Live OPD, tokens, queue, display, token page | `lib/services/opd.ts` |
| Doctor schedule, blocked time, OPD settings | `lib/services/schedule.ts` |
| Minimal patient registry (identity only) | `lib/services/patients.ts` |
| State machines + queue ordering + token format | `lib/scheduling/states.ts` |
| Clinic-timezone maths (no dependency) | `lib/scheduling/time.ts` |
| Staff UI | `/appointments`, `/opd`, `/settings/scheduling`, dashboard "Today" widgets |
| Public UI (clinic host) | `/book-appointment`, `/display/<secret>`, `/token/<token>` |
| Reminder hooks (events only) | `lib/events/appointments.ts` |
| Google Calendar | `lib/integrations/calendar.ts` — interface only, **not configured, nothing syncs** |

## Rules that make it safe
* **No double booking, enforced by the database.** `Appointment.slotLock` is `"<doctorId>|<startISO>"` and UNIQUE; it is `NULL` for CANCELLED / NO_SHOW so those free the slot. Concurrent requests for one slot → exactly one insert succeeds, the rest get a friendly 409. Tested with parallel requests.
* **Tokens are unique per clinic + day + prefix** (`@@unique([tenantId, tokenDate, tokenPrefix, tokenNumber])`), numbers come from an atomic `TenantCounter`. One visit per appointment (`appointmentId` unique) so no duplicate check-in.
* **The server decides everything.** Slots are computed server-side and re-validated on save. The browser never sends `tenantId`, `patientId` (without verification), a status, or a doctor of another clinic. Status changes are *actions* validated against `APPOINTMENT_TRANSITIONS` / `OPD_TRANSITIONS`, applied with optimistic `updateMany where status = from`.
* **Tenant isolation.** All new tables are in `TENANT_SCOPED_MODELS` (a test fails otherwise). Public routes resolve the clinic from the HOST only.
* **Patient privacy.** Calendar rows show a shortened name ("Meera S."), detail views the full name only to staff with access. Doctors see only their own appointments/queue. Patient search is masked; linking an existing patient needs verification (last 4 digits / DOB / patient ID) checked on the server and throttled; new patients go through a duplicate check that needs explicit confirmation.
* **Public display shows tokens only** — the server never sends names, phones or ids. It is protected by a secret key in the URL that admins can rotate or switch off. The patient token page works only with the unguessable `publicToken` on the right clinic host.
* **"Live" means polling.** `usePolling` polls every 4–5 s, pauses while the tab is hidden, backs off on errors and sends an ETag so unchanged queues cost one tiny response. No websockets, no fake real-time.
* **Voice announcements** use the browser's speech synthesis on the display screen (one click to enable, toggle in settings). Nothing is sent to a server.
* **Emergencies**: registering one needs `opd.priority`, puts the patient first in the doctor's queue, and writes `opd.created`, `token.assigned` and `token.priority_changed` audit rows. Every queue/appointment action is audited.

## Queue behaviour
* Call order: EMERGENCY → HIGH → arrival order (`compareQueue`).
* One patient CALLED / IN_CONSULTATION per doctor (serialised with a per-doctor counter row lock, so two desks racing can't both call).
* Hold → Resume keeps the original place. Skip → "back to end of queue" gets a new arrival number. Reassign moves only the live visit to another doctor of the same clinic.
* Waiting estimate = (people ahead + 1 if the doctor is busy) × the doctor's average consultation today (fallback: slot length). Labelled an estimate.

## Roles
| Role | Can |
|---|---|
| Clinic admin | everything, incl. schedules, blocked time, OPD settings, display link |
| Receptionist / Compounder | create & edit appointments (compounder: queue only), run the queue, register walk-ins, check-in; receptionist can set priority |
| Doctor | own appointments (view), own queue (call next / start / hold / skip / complete / recall / requeue / priority), own schedule + blocked time |
| Nurse | view queue and calendar |

## Out of scope (by design)
Full patient CRM, medical history, consultations, prescriptions, labs, billing, patient portal, WhatsApp/SMS reminders (events are emitted, no handler registered), analytics, Google Calendar sync.

## Phase 4 starting point
Extend the minimal `Patient` model into the full patient record, and hang consultations off `OpdVisit` (it already carries patient, doctor, appointment, token, timestamps and `IN_CONSULTATION → COMPLETED`).

## Run the checks
```bash
npm run lint && npm run typecheck && npm run db:check-schema && npm test
NEXT_DIST_DIR=.next-prod npm run build && NEXT_DIST_DIR=.next-prod npx next start -p 3101   # prod build for tenant-host pages
npm run db:seed && node e2e/phase3-opd.mjs        # also phase1-security.mjs (dev, :3000) and phase2-website.mjs (prod, :3101)
```
