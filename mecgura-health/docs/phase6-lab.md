# Phase 6 — Investigations, lab workflow, samples, reports and doctor review

Everything here reuses the Phase 0–5 foundation (tenants, RBAC, audit, design system, Patient/Consultation/DoctorOrder). Nothing is billed, paid, stocked or sent by SMS/WhatsApp/email, and nothing is interpreted: the system records what the doctor ordered and what the lab entered.

## Workflow

```
Doctor orders (consultation → Investigations tab)  ─┬─ InvestigationOrder LAB-2026-000001 (+ linked Phase 5 DoctorOrder type INVESTIGATION)
                                                    │
Lab: collect sample (SMP-2026-000001, one per sample type) → receive → start processing
     └─ reject → reason from the configured list → recollection = NEW sample (attempt n+1); old sample + custody events stay forever
Lab: enter results (draft) → submit            flags/ranges only from the test's configured reference data
Lab: generate report (RPT-2026-000001) → Lab reviewer: verify → release  ⇒ immutable version n (snapshot + SHA-256)
Doctor: notified in-app → opens the released report → acknowledge / mark reviewed
Amend: reviewer + reason → results reopen → verify → release ⇒ version n+1 (v1 is never changed)
```

Order status (ORDERED … DOCTOR_REVIEWED) is **derived** from items, samples, report and reviews after every action (`deriveOrderStatus`), so it cannot contradict them. Cancelling is only possible before any sample is collected.

## Roles

| Role | Can |
| --- | --- |
| Doctor | Order investigations for their own consultations, view their own orders, see results **only** from a released report, review/acknowledge, print slip/report |
| Lab staff (`lab.collect`, `lab.result`) | Collect/receive/reject samples, start processing, enter and submit results, generate reports, print labels/slips |
| Lab reviewer (= lab staff + the `lab.review` permission grant) | Verify, release, send back for correction, amend |
| Nurse | Collect samples |
| Receptionist | See orders/status, print the test slip. Never sees result values |
| Clinic admin | Everything, plus `lab.configure` (investigation master, lists, partners) |
| Platform admin, accountant, compounder, general staff | No access to laboratory records |

`lab.configure` is non-grantable (admin only). `lab.review` is granted per user from Team → permissions (the seed creates `labreviewer@…` demo users).

## Configurable master data (Settings → Laboratory)

Categories, sample types, departments and sample-rejection reasons are clinic-editable lists (suggestions are offered, none are required or hard-coded in logic). A test has a code (unique per clinic), name, category, sample type, department, preparation, turnaround and parameters (number / text / choice). Numeric parameters take optional reference ranges (gender, age band, low/high, critical low/high). **A result is flagged only when a configured range applies to the patient; otherwise it shows "Reference range not configured."** Choice values get a flag only if one was configured.

Orders store a **snapshot** of each test (name, sample type, preparation, parameters, ranges) so later master edits never change an existing order or report.

## Documents (authenticated, tenant-checked, never public)

* Test slip: `/lab/orders/[id]/slip`
* Sample label: `/lab/samples/[id]/label` — contains an opaque `barcodeToken` (no patient data) reserved for barcode/QR scanning; no scanner or QR image is generated yet
* Lab report: `/lab/reports/[id]?version=n`, download `/api/lab/reports/[id]/document?version=n` (HTML; "Save as PDF" from the print dialog)

All use the clinic's own name/logo/colours (never MECGURA branding), escape every value, and write view/print/download audit rows (ids only).

## Data model (new tables)

`LabConfigItem`, `Investigation`, `InvestigationParameter`, `LabPartner`, `InvestigationOrder`, `InvestigationOrderItem`, `Sample`, `SampleEvent` (append-only custody), `LabResultEntry`, `LabReport`, `LabReportVersion` (immutable), `LabReportReview`, `Notification`. All are in `src/lib/tenant/scoped-models.ts`, so every query is tenant-scoped. Numbers use `TenantCounter` keys `lab:YYYY`, `smp:YYYY`, `rpt:YYYY`. Migrations: `prisma/migrations/20261007071020_phase6_laboratory` (SQLite) and `prisma/migrations-postgres/20261007090000_phase6_laboratory`.

## Safety properties (all tested)

* Two people collecting the same sample at once → exactly one wins (guarded `updateMany` claim inside a transaction).
* Release is guarded by `status = VERIFIED` and `currentVersion`, so a double click can't create two versions.
* Doctors see only their own orders; reception/nursing never get result values; foreign-clinic ids answer not-found.
* Audit rows hold ids and field names only — never result values or clinical text.
* The linked Phase 5 doctor order follows the lab order (IN_PROGRESS on collection, COMPLETED on release, CANCELLED on cancel) and can't be changed by hand.

## Known limitations

* No barcode/QR image or scanner support (only the opaque identifier and a printable label).
* Reports are HTML (print → PDF); no server-side PDF.
* External laboratories are tracked **manually** (partner, reference). No partner API is connected ("External laboratory integration not configured").
* Lab reviewer is a permission grant on a lab-staff user, not a separate role.
* Notifications are in-app only; no SMS/WhatsApp/email.
* No analyzer/instrument interfaces, no billing/pricing of tests, no inventory/reagents.
* The header bell is still a placeholder; notifications are shown on the dashboard.

## Verification

`npx tsc --noEmit`, `npm run lint`, `npm run db:check-schema`, `npx vitest run` (includes `lab.integration.test.ts`), and on a production build `node e2e/phase6-lab.mjs` (API, UI and a 375/768px responsive sweep).
