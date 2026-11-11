# Phase 15 — Subscription, plans & MECGURA clinic billing

MECGURA charges **clinics** for MECGURA HEALTH. This is completely separate from Phase 8 (clinic → patient billing): own tables (`Saas*`), own numbers (`MEC-INV/REC/RFD-YYYY-NNNNNN`), own provider abstraction.

## Model
| Model | Purpose |
|---|---|
| `Plan` | name, slug (`key`), status DRAFT/ACTIVE/INACTIVE/ARCHIVED, monthly/yearly price + setup fee in **paise**, trial days, public flag, `features` JSON, `limits` JSON, `version`. Never deleted — archived. Legacy rows (empty feature map) are old menu bundles and cannot be sold. |
| `Subscription` | one per clinic. `managed=false` = legacy row (no billing, no limits — everything behaves exactly as before). `managed=true` = commercial subscription with a **snapshot** of the plan (features, limits, price, version) so editing a plan never re-prices or re-limits an existing customer. |
| `SubscriptionBillingProfile` | the clinic's billing details (GSTIN optional, validated when given). |
| `SaasInvoice` / `SaasInvoiceItem` | invoice with tax, vendor and bill-to **snapshots**, unique `dedupeKey` (one invoice per purpose/period), `changeJson` (plan switch applied when paid). |
| `SaasPayment` | one row per payment attempt; unique `idempotencyKey` and unique `(provider, providerPaymentId)`. |
| `SaasRefund` | separate record: REQUESTED → APPROVED → PROCESSED (or REJECTED/CANCELLED). Doubles as the credit-note record. |
| `SubscriptionWebhookEvent` | unique `(provider, eventId)`; payload hash only. |
| `SubscriptionUsage`, `SubscriptionEvent`, `PlatformCounter` | usage history per billing month, append-only history, atomic numbering. |

## State machine (`src/lib/subscriptions/state.ts`)
```
PENDING_PAYMENT → ACTIVE | TRIAL | CANCELLED
TRIAL           → ACTIVE | EXPIRED | CANCELLED | SUSPENDED
ACTIVE          → PAST_DUE | PAUSED | CANCELLED | SUSPENDED | EXPIRED
PAST_DUE        → ACTIVE | GRACE | CANCELLED | SUSPENDED
GRACE           → ACTIVE | SUSPENDED | CANCELLED
PAUSED          → ACTIVE | CANCELLED
SUSPENDED       → ACTIVE | CANCELLED | EXPIRED
CANCELLED/EXPIRED → PENDING_PAYMENT   (a new paid subscription; never straight to ACTIVE)
```
Every status change goes through `transition()` (compare-and-set on the old status + history row). A trial **never** charges: when it ends it becomes EXPIRED.

## Money rules
* Integer paise only; tax is configuration (`subscription.tax`), nothing assumed. INCLUSIVE/EXCLUSIVE, CGST+SGST (same state code) or IGST. Tax lines are snapshotted on the invoice.
* **A subscription becomes ACTIVE only when an invoice is fully PAID**, and PAID happens only from (a) a signed webhook **re-verified with the provider's API**, (b) a provider status lookup (`syncInvoicePayment`), or (c) a Super Admin recording an offline payment (password + reason). The browser redirect is never evidence.
* `applyPayment` is idempotent and concurrency-safe (unique keys + compare-and-set on the pending checkout row): N identical events ⇒ 1 payment, 1 receipt, 1 activation.
* Upgrades: prorated on the server (price difference for whole remaining days), invoice first, plan switches when paid. Downgrades: blocked while current usage exceeds the new limits; otherwise scheduled for the period end (renewal invoice uses the new price). Nothing is ever deleted.
* Renewal = an invoice issued `renewalInvoiceLeadDays` ahead; there is **no card auto-debit**. Unpaid: PAST_DUE (at due date) → GRACE (after `dunningDays`) → SUSPENDED (after `graceDays`). Policy for what each state may do (FULL / READ_ONLY / BLOCK, and the patient portal) is configurable.

## Entitlements (`src/lib/services/entitlements.ts`)
One service answers "may this clinic use/add that?" from the clinic's own snapshot: `entitlementOf`, `canUseFeature`, `checkLimit`, `assertCanCreate`, `usageSnapshot`, `noteUsage` (80/90/100 % notifications, once per period + level). Features are the **Phase 14 feature keys** (effective = plan includes it AND the Super Admin has not switched it off — `disabledFeaturesOf` returns the union). Enforced server-side at: auth context (permissions removed), patient registration, appointment creation (staff, public site, portal), staff/doctor invitation / role change / re-activation, patient messaging (WhatsApp/SMS/email allowance), public site host resolution (`publicWebsite`, `customDomain`), custom-domain requests.
Counting rules: doctors / staff = ACTIVE + INVITED users (separate pools); patients = not archived/deleted; appointments and messages = created in the current **billing month** (monthly anniversary of the period start, so a yearly plan still gets a monthly allowance); storage = `TenantAsset` bytes. Locations are recorded but not counted (multi-location is not built).

## Scheduler
`runSubscriptionJobs(now)` runs inside `/api/internal/communications/run` (needs `CRON_SECRET`): overdue sweep, trial end/ending, period end (cancel/expire/free rollover), renewal invoices, dunning, stale unpaid first invoices (14 days), usage history. Idempotent; clock is injectable for tests.

## Configuration required (nothing is pre-filled)
* `SUBSCRIPTION_PAYMENT_PROVIDER=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; register `<APP_URL>/api/webhooks/subscriptions/razorpay` (payment.captured, payment_link.paid, payment.failed, refund.processed). Without these the clinic sees "online payment isn't available" and Super Admins record offline payments.
* Super Admin → Subscriptions → Billing settings: MECGURA legal name/GSTIN/address/support details (invoices show only the brand name until filled), tax, policy.

## Not built (honest limits)
No provider-held recurring mandates / auto-debit; no provider-side pause/proration; add-ons and multi-location are data-model foundations only; storage metering covers `TenantAsset` only; limit checks read-then-write (a burst of concurrent creations can overshoot a limit by a small amount); suspended subscriptions do not auto-expire; payment-method vault (cards/UPI mandates) is not stored — the provider's hosted page handles it; one SUPER_ADMIN password re-entry guards money actions (no separate approver rule).
