# Phase 9 — Plans, billing, usage and analytics

## Plans — data, not code

- Starter, Growth, Pro and Enterprise are **rows in the database**, created by the seed only when their slug doesn't exist. The seed never overwrites anything the admin has edited.
  - Enterprise is seeded unlimited and `selfServe = false`, so clients see "Contact MECGURA" instead of a buy button.
- No limit, price or feature is hardcoded anywhere in the application code. Every check reads the workspace's current plan (`entitlements.ts`), so an admin edit takes effect on the very next request.
- **Admin → Billing & Plans → Plans** edits:
  - price;
  - team seats, WhatsApp numbers, messages/month, new contacts/month;
  - campaigns launched/month, active automations, AI replies/month, API requests/month;
  - the included **features**: campaigns, automations, WhatsApp Flows, AI agent, API access, webhooks, analytics;
  - active, and "clients can choose it themselves".
- `-1` means unlimited. A partial `PATCH` changes only the fields it sends (a regression test covers this).

### What is enforced, and where

| Rule | Enforced at |
| --- | --- |
| Seats, numbers | add member, connect number (plan helpers `wouldExceed`) |
| Messages / month | inbox send, campaign compliance review |
| New contacts / month | contact create, import, API |
| Campaigns / month | campaign launch (+ feature) |
| Active automations | activation (+ feature) |
| Flows, AI agent, API keys, webhooks, analytics | create/activate/use, each checks its feature |
| AI replies / month | the AI engine skips with a logged reason when the allowance is used up |
| API requests / month | every API call after the key is validated (429) |
| API access feature | every API call (a key stops working the moment the plan loses it) |
| Webhook feature | event emission (no deliveries are queued without it) |

A workspace that never had a plan is unrestricted, as before.

## Billing (client: `/billing`, owners manage, managers read)

- **Plan tab:**
  - current plan, price, status, payment status (paid / due / overdue / failed / not billed), next billing date;
  - the plan grid, upgrade, downgrade and cancel.
- **Usage tab:** the 8 tracked metrics with meters, plus daily charts.
- **Invoices tab:** list, a printable invoice page `/billing/invoices/:id` with issuer and bill-to snapshots, and **Pay** when a gateway is connected.

### Plan changes
- **Upgrade:**
  - it creates a **real invoice**: prorated by whole days for the rest of the period, or the full month for a first plan;
  - the plan switches **only when the invoice is paid**, and it keeps the renewal date;
  - asking twice returns the same invoice.
- **Downgrade:**
  - it is checked against current usage (seats, numbers, active automations) and refused with reasons if it doesn't fit;
  - it is scheduled for the period end, and can be undone with "Keep my plan";
  - if usage no longer fits at that moment, the change is cancelled and the owner is told.
- **Cancel:**
  - an invoiced plan keeps working until the period ends;
  - a contracted plan ends at once;
  - **Resume** undoes a scheduled cancel.
- After cancellation, **sending is blocked** (incoming messages still arrive) until a plan is chosen and paid.
- Tax rate, due days, grace days, company details and "how to pay" are admin settings, not code.

### Billing cycle (`runBillingCycle`, run every minute by the scheduler, idempotent)
- It honours scheduled cancellations and downgrades, and renews: invoiced plans get the next invoice, contracted plans just roll over.
- Legacy subscriptions with no period are **initialised from now**, so nobody is back-billed.
- An overdue invoice sends a notice once and marks the workspace `past_due` (still sending). After the grace period it becomes **blocked** until paid.
- **Billing modes:**
  - `complimentary` = contracted by MECGURA, never invoiced automatically (the default, so existing clients aren't surprised);
  - `invoiced` = billed monthly.
  - The admin chooses the mode when assigning a plan.

## Payments — nothing is faked

- **Abstraction** (`src/providers/payments/`): a `PaymentGateway` interface with `createCheckout`, `parseWebhook` (signature check over the raw body) and optional `verifyClientReturn`. Gateways register in `registry.ts`; connecting another provider means implementing the interface.
- **Razorpay adapter** included: orders, `payment.captured` / `payment.failed` webhooks, HMAC verification with `RAZORPAY_WEBHOOK_SECRET`, and verification of the checkout return with the key secret.
- **When nothing is connected:**
  - paying online returns 409 "Online payments aren't connected yet";
  - invoices stay **unpaid** until the admin records money actually received (Invoices → **Mark paid**, with a reference). That is audited and is the only manual path.
  - There is no "simulate payment" anywhere.
- **Safety:**
  - an invoice is paid only by a verified gateway event or an admin recording;
  - amounts and currency must match the invoice, otherwise the payment is marked failed;
  - each `(gateway, eventId)` is processed once, and a paid invoice is never applied twice;
  - a payment's reference must be one we created;
  - the browser's checkout return is verified server-side;
  - failed payments leave the invoice open, notify the owner and show under Admin → Payments.
- The webhook endpoint is `POST /api/webhooks/payments/:gateway`. Payloads are not stored, only event ids.

## Usage

Messages sent (billable, live numbers only), messages received, new/total contacts, campaigns launched, automation runs (+ failures), active automations, AI replies (live only), API requests, WhatsApp numbers and team members. Monthly counters follow the IST calendar month.

## Admin billing (`/admin/billing`)

- **Overview:**
  - revenue collected this month, last month and 12 months, by month — **paid invoices only**;
  - MRR (contracted / invoiced / contracted-offline), subscriptions (active, invoiced, cancelling, past due, new, cancelled), active plans with client count and MRR;
  - receivables (open and overdue), failed payments, and the gateway status.
- **Plans, Invoices** (filter, search, mark paid, void), **Payments**, and **Settings** (tax, due, grace, company and payment details, "run billing cycle now").
- The client page's Plan tab chooses billing mode on assignment.

## Analytics

- **Client `/analytics`** (owners and managers; needs the `analytics` feature; optional number filter; 7/30/90 days). Everything is computed from the workspace's real data.
  - Messages in/out per day.
  - Delivery, read and failure rates.
  - Conversations started, open and unassigned.
  - Response rate, and median first-response time overall and per teammate.
  - Within-5-minutes share.
  - Leads: created, converted, pipeline, source.
  - Campaign delivery, read and reply.
  - Automation success.
  - Agent performance, and the AI agent (live and demo shown separately, with handoffs).
- **Admin `/admin/analytics`:**
  - client growth, the onboarding funnel, revenue;
  - usage per metric per day and top clients;
  - system usage: webhook success, API errors and rate limits, Meta events, failed live messages, queue depth, automation failures.

## Data and config

- New models: `Invoice`, `Payment`, `PaymentEvent`, `InvoiceSequence` (gap-free `INV-YYYY-NNNNNN`).
- `Plan` gains `maxCampaigns`, `maxAutomations`, `maxAiReplies`, `maxApiRequests`, `features`, `selfServe`.
- `Subscription` gains `billingMode`, `currentPeriodStart/End`, `cancelAtPeriodEnd`, `canceledAt`, `pendingPlanId`, `endReason`.
- Migrations: `phase9_billing`, `phase9_invoice_overdue_notice`, `phase9_plan_self_serve`. `schema.postgres.prisma` is kept identical.
- New env var: `RAZORPAY_WEBHOOK_SECRET` (names only in `.env.example`).
- New permissions: `billing:read` (owner, manager), `billing:manage` (owner), `analytics:read` (owner, manager).

## Tests (`tests/integration/billing.test.ts`, 22)

- **Plans:**
  - editing every field and feature, partial edits, validation and admin-only access;
  - seats, numbers and contacts change immediately when the admin edits the plan;
  - feature gates for 7 features, and a key stopping when the plan loses API access;
  - monthly allowances.
- **Money math:** proration, month-end, tax rounding.
- **Billing flow:**
  - permissions, and an upgrade creating an invoice with the plan unchanged until paid;
  - **no fake payment** (409 with no gateway; clients can't mark paid);
  - signed webhooks: bad signature, failure, amount mismatch, unknown reference, success, and replay;
  - forged vs real checkout return;
  - downgrade checks, scheduling, undo and the cycle;
  - cancel → blocked sending → resubscribe;
  - complimentary clients not invoiced, and legacy rows not back-billed;
  - renewal once per period, overdue → past due → blocked → paid → ok;
  - void;
  - tenant isolation;
  - admin revenue counting only collected money.
- **Usage and analytics:**
  - all 8 usage lines;
  - no-plan = unrestricted;
  - analytics numbers checked against known data (rates, response times, leads, per-agent);
  - the number filter, a foreign number → 404, roles, and admin analytics.
