# MECGURA – Development status

Living log for the "Final existing platform gap completion" run (started 2026-11-04). Feature inventory:
`docs/LIVE_FEATURES.md`; keys/approvals: `docs/CONFIGURATION_REQUIRED.md`; stage history: `docs/PHASE_STATUS.md`.

## 1. Audit of the 4 Nov overview (verified in the repository)

Every module in the overview has routes, UI and integration tests in `tests/integration/` (65 test files before this run):
inbox (+SLA/CSAT/monitor), contacts/deals/lead scoring, campaigns (+A/B, ROI), automations (+switch, sub-flows,
approvals), AI agent (+knowledge, crawl, versions), loyalty, reviews, landing pages, social (+approvals), Shopify/WooCommerce,
API keys/webhooks, support, billing/wallet/invoices, agreements, admin revenue/health/marketing/outreach/site/blog.
Nothing listed was found missing or broken. The real gaps were the two "not built" items plus the P3/P4 items below.

## 2. Work log

### P1 – Automatic recurring payments (Razorpay Subscriptions) ✅ built
- Model `Autopay` (migration `20261119090000_autopay`).
- `src/services/billing/autopay.ts`:
  - start: creates a Razorpay plan (cached) + subscription; first charge on the next billing date; hosted authorisation link
  - stop; sync/reconcile from Razorpay
  - webhook handling for subscription.authenticated / activated / charged / pending / halted / cancelled / completed / paused / resumed
  - a charge pays the matching open invoice only if the amount matches (it creates the period's invoice first via the idempotent cycle)
  - duplicate events are blocked by `PaymentEvent`; duplicate payments by the payment id
  - plan change: the mandate carries over when the charge is unchanged (e.g. trial → paid), otherwise it is cancelled and owners are told
  - cancelling the plan cancels the mandate
- Dunning: the pre-due reminder becomes "will be paid by auto-pay"; overdue reminders, grace period and pause are unchanged.
- UI: Billing → "Auto-pay (card / UPI)" card; Admin → Billing → Auto-pay tab (status, method, charge counts vs Razorpay, problem charges).
- Audit actions `billing.autopay_*`.
- Tests: `tests/integration/billing-autopay.test.ts` (11).
- **Needs:** Razorpay Subscriptions enabled on the account, plus subscription.* events on the webhook. Never simulated.
