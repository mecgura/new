# Phase 13 — Analytics, Report Center & Clinic Intelligence

Descriptive analytics over the clinic's own records. Every number is a **count, sum or time difference of real rows** of the signed-in user's clinic. There is no estimate, forecast, ranking, AI or medical advice anywhere.

```
page / API  ->  analytics-*.ts service  ->  runDomain(): guard -> env -> cache -> compute -> (audit)
                                              |            |        |
                       analytics.view + domain permission  |   tenantDb(ctx) (tenant from SESSION)
                                              doctor scope forced for DOCTOR role; doctorId validated against this clinic
```

## Files
* `src/lib/analytics/` — pure, unit-tested: `range.ts` (presets in the clinic timezone, previous period, comparison with "N/A" rule, rates), `stats.ts` (median/average, age groups, tally, zero-filled series), `insights.ts` (rules + thresholds), `export.ts` (CSV, hand-written XLSX/ZIP writer, printable page).
* `src/lib/services/analytics-core.ts` (guards, env, cache, drill links), `analytics-people.ts` (patients, appointments, OPD, follow-ups, doctors), `analytics-clinical.ts` (consultations/diagnoses/prescriptions, lab), `analytics-business.ts` (billing, pharmacy, communication), `analytics-command.ts` (Command Center, insights, scorecard, thresholds, platform counts), `analytics-reports.ts` (Report Center, exports, scheduled-report foundation).
* `src/app/api/analytics/**`, `src/app/(app)/analytics/**`, `src/components/analytics/**`.
* Migration `20261014090000_phase13_analytics` (SQLite + PostgreSQL).

## Permissions (new, on the existing RBAC)
`analytics.view` (open the area) · `analytics.patients` · `analytics.operations` (appointments, OPD, follow-ups, doctors) · `analytics.clinical` · `analytics.financial` · `analytics.lab` · `analytics.pharmacy` · `analytics.communication` · `analytics.configure` (thresholds, schedules; admin-only) · `reports.export` · `reports.export_financial` · `reports.export_patient` (names/contacts in exports; admin-only).

| Role | Sees |
|---|---|
| Clinic admin | everything |
| Doctor | patients, operations, clinical, lab — **own data only** (forced on the server) |
| Receptionist | patients, operations |
| Nurse | operations |
| Lab staff | lab |
| Accountant | financial (+ financial exports) |
| Pharmacy manager | pharmacy (+ export) |
| Pharmacy staff, compounder, staff, patient | nothing |

## Definitions (also shown in the UI)
* **Ranges** — Today, Yesterday, Last 7/30 days, This/Last month, This quarter, This year, Custom (max 366 days), all computed from the clinic's midnight, not UTC. Previous period = the equal-length period immediately before. A comparison shows **N/A** when the previous value is zero or the clinic did not yet exist.
* **No-show rate** = no-shows ÷ appointments that were *due* (not cancelled, start time passed). **Cancellation rate** = cancelled ÷ all. **Reschedule rate** = appointments ever rescheduled (audit trail) ÷ all. **Funnel** counts appointments that reached each stage.
* **Waiting time** = check-in → called; **consultation time** = start → completed; negative or missing times are excluded; with no usable samples the UI says *Data unavailable*. Median/average/longest shown.
* **New vs returning** use distinct patients; **retention** = patients seen in the previous equal period who were seen again.
* **Follow-up completion** = completed ÷ due in the period excluding cancelled. Overdue is a live snapshot.
* **Lab turnaround** = order (or sample receipt) → report released, for reports released in the period. **Rejection** = rejected ÷ collected samples.
* **Billing** (integer minor units, from invoice snapshots): gross = Σ subtotal; discounts; taxes; net billed = Σ total; **collected** = successful payments by payment date; **refunded** = refunds processed in the period; net collected = collected − refunded; outstanding = unpaid balance of collectible invoices. Invoice, payment and refund are never added together. This is operational reporting, not profit or accounting.
* **Pharmacy** — stock status/expiry are live snapshots (same rules as the pharmacy module); stock value = quantity × batch purchase price, or "Stock valuation not configured".
* **Communication** — counts and delivery states only; channels that do not report a state show *Not available*; message text and recipients are never read.

## Report Center
15 fixed server-side reports in 7 categories (Clinical, Operational, Financial, Patient, Lab, Pharmacy, Communication). A client sends a report **key** and validated filters, never a table/column. Each report carries name, description, data source, range, filters, generated-at, timezone and generated-by. Patient names/phones are only fetched for users with `patients.identity` and only **exported** with `reports.export_patient`; otherwise patients appear as Patient ID. Exports: CSV (formula-injection safe, metadata header, streamed in chunks), XLSX (real workbook + "Report information" sheet), printable page for Save-as-PDF. Max 50,000 rows per export (flagged as truncated). Scheduled reports: definitions only.

## Performance & caching
Aggregation in the database (`groupBy`/`count`) where possible; row scans select only needed columns and are capped (100,000). Results are cached 60 s in memory keyed by tenant + range + filters + role + scope + permission signature (`ANALYTICS_CACHE_TTL_MS`, `refresh=1` bypasses); every result shows "Last updated". New indexes: `InvestigationOrder(tenantId, orderedAt)`, `Consultation(tenantId, startedAt)`, `CommunicationMessage(tenantId, createdAt)` (range scans that no existing index served).

## Audit
`analytics.viewed` (sensitive domains), `analytics.report_generated`, `analytics.report_exported` (report, format, row count, whether identity was included), `analytics.config_changed`, `analytics.schedule_saved/deleted`. Metadata holds ids/counts only.

## Not built / limits
* **PDF** is a print-optimised page (browser Print → Save as PDF), not a server-rendered PDF file; no PDF library is installed.
* No background job queue: large exports are generated in the request (capped, streamed in chunks). Scheduled reports are stored but **nothing is generated or sent**.
* Cache is per server process (not shared across instances); data can be up to 60 s old unless refreshed.
* Doctor utilisation is not calculated (no capacity model). Cancellation/rejection reasons are shown only where staff recorded them.
* Super Admin gets clinic counts and status only; richer platform analytics belong to the later platform phases.
* Not built (by design): AI insights/prediction, accounting/profit, subscription analytics, marketing attribution.
