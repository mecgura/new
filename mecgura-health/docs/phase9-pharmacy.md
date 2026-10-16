# Phase 9 — Pharmacy, medicine inventory and dispensing

Operational pharmacy for the clinic: medicine master, suppliers, purchases, batches with expiry, an immutable stock ledger, dispensing of **finalized** prescriptions (FEFO, partial dispensing), returns, low-stock / expiry alerts, pharmacy billing through Phase 8, reports and documents. It is an inventory system: it never prescribes, recommends, substitutes or changes a prescription.

## Stock model
* Quantities are whole base units (tablet, ml, vial …). Money is integer minor units (Phase 8 convention).
* A batch (`MedicineBatch`) = medicine + the supplier's batch number + expiry. `quantityAvailable` is changed **only** by `applyStock`, which updates the batch with a compare-and-swap (never below zero) and writes the immutable `StockTransaction` row in the same database transaction. Ledger rows are never updated or deleted; mistakes are fixed with a new row (adjustment / reversal).
* Invariant: for every batch, `quantityAvailable == Σ ledger.quantity` (`reconcileStock` checks it; tests assert it in every clinic).
* Ledger types: OPENING, PURCHASE, DISPENSE, RETURN, SALE_RETURN, PURCHASE_RETURN, ADJUSTMENT_IN, ADJUSTMENT_OUT, DAMAGE, EXPIRY, REVERSAL (TRANSFER_IN/OUT are reserved for the future transfer workflow).
* **Available to dispense** = unblocked, unexpired (valid through its expiry date) batches with stock. Expired / blocked stock stays visible and in history.
* Batch status shown: ACTIVE, LOW_STOCK, EXPIRED, BLOCKED, DEPLETED — BLOCKED is stored; the rest are derived from quantity and dates. Near-expiry window is a clinic setting (default 90 days).
* Low stock = available ≤ max(reorder level, minimum stock). Nothing is ordered automatically.
* Stock value = quantity on hand × batch purchase price. It is labelled "cost", never profit.

## Workflows
* **Purchase**: DRAFT → RECEIVED (batches created/extended, one PURCHASE ledger row per line incl. free units) → COMPLETED; DRAFT can be CANCELLED. A received purchase is reversed with a purchase return. Totals are computed on the server.
* **Dispensing**: only FINALIZED prescriptions. The medicine must match the prescribed line exactly (generic or brand name, and strength when both state one) — there is no fuzzy match and no substitution; otherwise "Prescribed medicine unavailable — contact the doctor". Batches default to FEFO (earliest expiry first, spilling into the next batch); picking another batch needs a reason. Over-dispensing is refused unless the clinic enables it. Partial dispensing leaves the prescription untouched; what remains is derived from dispensing history (keyed by medicine + strength so it survives amendments).
* **Billing**: inside the same database transaction as the stock change, an ISSUED Phase 8 invoice (`sourceKey dispense:<id>`, MEDICINE lines, clinic tax mode) is created from the dispensing snapshot — no stock without a bill and no bill without stock, and replays create nothing. Payments are collected in Billing (accountant / reception). Cancelling a dispensing writes REVERSAL rows and cancels the bill, but only while nothing was collected.
* **Returns**: patient return (only if clinic policy allows, within the return window) REQUESTED → APPROVED → RECEIVED (condition recorded) → RESTOCKED (only sealed, unexpired) or DISPOSED; REJECTED releases the reserved quantity. Returned medicine never becomes sellable by itself. Purchase return takes stock back to the supplier immediately (PURCHASE_RETURN). Refunds to patients are handled in Billing.
* **Physical count**: system vs physical, reasons mandatory for differences, applied as ADJUSTMENT rows; a line whose stock moved after the count started is refused. Damage, expired write-off (only for expired batches) and batch blocking are manager actions.
* **Concurrency**: dispensing serialises per prescription (row lock through a counter), stock changes are atomic compare-and-swaps, idempotency keys deduplicate retries. Tested with parallel requests.

## Roles
* `PHARMACY_STAFF`: view medicines/stock, dispense, request returns. (`pharmacy.receive` can be granted per user.)
* `PHARMACY_MANAGER`: + purchases, receive, suppliers, medicines (price changes audited with reason), adjustments, counts, damage, expiry, block, approve returns, cancel dispensing, reports/export.
* `CLINIC_ADMIN`: everything + settings, lists (forms, categories, units) and opening stock.
* `DOCTOR`: availability only (in stock yes/no). `ACCOUNTANT`/reception: pharmacy bills appear as normal invoices in Billing; no stock access. Super admin: no clinic pharmacy records.

## Routes
`/pharmacy` (dashboard), `/pharmacy/medicines` (+ `[id]`), `/pharmacy/stock` (+ `[id]` batch), `/pharmacy/purchases` (+ `new`, `[id]`, `[id]/edit`), `/pharmacy/suppliers` (+ `[id]`), `/pharmacy/dispensing` (+ `[prescriptionId]`), `/pharmacy/dispensed/[id]`, `/pharmacy/returns`, `/pharmacy/expiry`, `/pharmacy/adjustments`, `/pharmacy/ledger`, `/pharmacy/reports`, `/pharmacy/settings`, `/pharmacy/docs/[kind]/[id]`; Patient 360 → Pharmacy tab and timeline filter. (The project's routes are not under `/dashboard`.)

## API (`/api/pharmacy/…`)
dashboard, settings, config(/id), medicines(/id, /pick), availability, suppliers(/id), purchases(/id, receive, complete, cancel), batches(/id, /id/block), ledger, stock/(opening, adjust, damage, expire, reconcile), counts(/id, apply, cancel), queue, prescriptions/[id](/dispense), dispensings(/id, cancel), returns(/supplier, /id/action), reports(/export), docs/[kind]/[id]; `/api/patients/[id]/pharmacy`.

## Database (13 tables)
PharmacySettings, PharmacyConfigItem, Medicine, Supplier, Purchase, PurchaseItem, MedicineBatch, StockTransaction, Dispensing, DispensingItem, MedicineReturn, StockCount, StockCountLine. SQLite migration `*_phase9_pharmacy`, PostgreSQL `20261010090000_phase9_pharmacy`. Numbers: MED-, SUP-, PUR-YYYY-, DSP-YYYY-, RET-YYYY-, CNT-YYYY- (tenant-scoped counters). New roles PHARMACY_STAFF / PHARMACY_MANAGER, permissions `pharmacy.*`.

## Documents
Purchase invoice, pharmacy bill, dispensing slip, stock report, expiry report, return document: private, authenticated, tenant- and permission-checked, clinic branding only, escaped, content from snapshots; view / print / download audited. The slip carries the doctor's written instructions but no diagnosis or clinical notes.

## Known limitations
* No pharmacy locations / stock transfers yet (ledger types reserved; no unnecessary multi-location complexity).
* Quantities are whole units (no fractional ml); at most 999 units per batch per bill line (Phase 8 invoice limit); amounts capped at ~₹2 crore (Phase 8).
* No external medicine database, barcode provider, supplier API, payment gateway or e-pharmacy; nothing is sent to patients.
* The prescription worklist derives status from the 300 most recent finalized prescriptions (search finds older ones).
* Medicine matching is deliberately strict; the pharmacy has no substitution workflow.
* Pharmacy staff don't collect payment (Billing permissions); stock value is at cost, not accounting.
* HTML print → "Save as PDF"; CSV only.

## Future
Patient Portal (prescriptions, dispensed medicines, bills), WhatsApp/SMS/email delivery of prescription and bill, supplier APIs, barcode scanning, multi-location transfers, accounting export.
