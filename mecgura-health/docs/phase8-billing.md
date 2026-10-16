# Phase 8 — Billing, invoices, payments, receipts, refunds

Operational clinic billing (not accounting). Clinical and financial data are separate: invoices keep snapshots of what was billed and link to Patient / Appointment / OPD visit / Consultation / Investigation order / Follow-up only by id.

## Money
* All amounts are **integer minor units** (paise/cents), 32-bit cap `2,000,000,000` (≈ ₹2 crore per amount). Currency is explicit (default INR, 2 decimals).
* Percentages (discount, tax) are **basis points**. Rounding is half away from zero via BigInt mul/div. Invoice-level discount is allocated over eligible lines by largest remainder, so lines always add up to the total.
* Tax is configurable (`BillingTax`), exclusive or inclusive, with a snapshot on every item. The server always recalculates; client totals are never trusted.

## Lifecycle
```
Invoice DRAFT → ISSUED (INV-2026-000001, immutable items) → PARTIALLY_PAID → PAID
                       ↘ CANCELLED (with reason; only if nothing collected)   PARTIALLY_REFUNDED / REFUNDED after refunds
```
* Stored: `collectedMinor` (successful payments), `refundedMinor` (processed refunds), `dueMinor = total − collected`. Refunds never re-create dues. `paidMinor = collected − refunded` is derived. **OVERDUE** is derived from the due date, never stored.
* Payments (`PAY-…`, receipt `REC-…`): CASH / UPI / CARD / BANK_TRANSFER / CHEQUE / OTHER; partial and multiple payments; no over-payment; idempotency key and unique (method, reference); compare-and-swap updates keep concurrent collection safe. **ONLINE is refused** — "Payment gateway not configured."
* Refunds (`REF-…`): REQUESTED → APPROVED → PROCESSED (or REJECTED). Separate permissions for request / approve / process; approver ≠ requester unless the clinic enables `refundSelfApproval`. Cannot exceed what was collected minus already-refunded.
* Discounts need a configured role rule (default: none). Percent and fixed, invoice or item level, with reason, audit.

## Automatic invoices
Only if enabled in billing settings: finalized consultation, created investigation order, or a follow-up booking creates a **DRAFT** invoice (deduped by `sourceKey`). Never issued or paid automatically; billing failure never blocks the clinical flow.

## Roles
Accountant: full billing + reports/export. Reception: create/edit/collect/discount (within limits)/request refunds. Clinic admin: everything incl. settings, services, approvals. Doctor: `billing.view_own` — only invoices of own consultations, no patient identity, cannot collect. Lab/nurse: none.

## Documents
Invoice, receipt, refund receipt, patient statement: tenant-branded HTML (never MECGURA branding), authenticated routes only, print/download/view audited, all text escaped. Print → "Save as PDF".

## Reports
Daily collection, method-wise, date-wise, service-wise, outstanding, refund summary; CSV export (financial columns only, formula-injection safe). Optional cashier sessions (open / close with counted cash and difference).

## Routes
`/billing`, `/billing/invoices` (+ `new`, `[id]`, `[id]/edit`, `[id]/print`), `/billing/payments` (+ `[id]/receipt`), `/billing/refunds` (+ `[id]/receipt`), `/billing/outstanding` (+ statement/[patientId]), `/billing/services`, `/billing/reports`, `/billing/settings`; Patient 360 → Billing tab; billing chips on appointment, consultation, investigation and follow-up screens.

## API (`/api/billing/…`)
dashboard, settings, taxes(/id), services(/id), invoices (preview, from-source, /id, issue, cancel, payments), payments(/id/cancel), refunds(/id/action), session, status, reports(/export), docs/[kind]/[id]; `/api/patients/[id]/billing`.

## Database (9 tables)
BillingSettings, BillingTax, BillingService, Invoice, InvoiceItem, Payment, Refund, InvoiceEvent, CashierSession. SQLite migration `*_phase8_billing`, PostgreSQL `20261009090000_phase8_billing`.

## Known limitations
No real payment gateway / online payment / gateway refund API (hooks only). Amount cap ≈ ₹2 crore. Assumes 2-decimal currency. HTML print (no server PDF). CSV only. Custom invoice lines allowed. Medicine billing needs pharmacy/inventory (not built). No accounting, GST filing or ledger.

## Future
Razorpay/Stripe + webhooks, patient portal payments, WhatsApp/SMS/email invoice delivery, accounting export, pharmacy/inventory billing.
