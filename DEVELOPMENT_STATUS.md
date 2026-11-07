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

### P2 – OpenAI as an alternative AI provider ✅ built
- `src/providers/openai/chat.ts`: official Chat Completions API.
  - Same system prompt, knowledge base and relevant passages as Claude.
  - Same strict tool schemas (save contact, qualify, book, transfer), tool round-trips and handoff.
  - Summaries, automation AI step and social captions (strict JSON schema).
  - Errors mapped: 429/5xx/network are retryable; 4xx are not.
- `src/providers/ai/router.ts`: one entry point for every AI feature.
  - Provider (auto / Anthropic / OpenAI) and model per provider are set in Admin → Integrations readiness.
  - Optional fallback only when switched on, only for outages/auth errors, and never after the agent already ran an action.
  - Per-provider health (last success/failure) and a real test call.
- Anthropic integration preserved: the same functions, now with a model parameter; shared helpers `agentTools`, `toAction`, `knownLine`.
- Usage/tokens/cost: the existing `AiInteraction` logs model + tokens; OpenAI list prices were added to `src/lib/ai-cost.ts` (estimates).
- Keys only from env (`OPENAI_API_KEY`, optional `OPENAI_MODEL`); the settings API refuses unknown fields such as an api key.
- Tests: `tests/integration/ai-providers.test.ts` (11, covering P2 + P4).

### P4 – Integration readiness dashboard ✅ built
- Admin → Integrations readiness (`/admin/readiness`): 14 services, with statuses LIVE / CONFIGURATION REQUIRED / APPROVAL REQUIRED / PRACTICE MODE / COMING SOON / NOT IMPLEMENTED.
- **LIVE only after a real verification request succeeded within 7 days.** Checks used:
  - Anthropic/OpenAI: a tiny completion
  - Resend: GET /domains
  - Gemini: list models
  - Maps: Places searchText with an ids-only field mask
  - Meta: Graph app lookup with the app token
  - Razorpay: orders list
  - Razorpay Subscriptions: subscriptions list; a refusal shows APPROVAL REQUIRED
- Results are stored in `SiteSetting` `readiness:*` and audited as `integration.verified`.
- The System health "AI provider" check now uses real call/verification results.

### P3 – Advanced product improvements
Audit first — these already existed and were **not rebuilt**:
- Workflow visual debugging / execution tracing: automation Logs + execution drawer with every step, attempt, output and error, highlighting the node on the canvas.
- Client onboarding: the dashboard "Getting started" checklist plus Agreement & KYC onboarding.
- Integration health: System health (and now Integrations readiness).
- Subscription dunning & reconciliation: payment reminders, grace period, plus the new auto-pay reconciliation (P1).

Built in this run:
- **AI agent automated tests (evaluation playground)**
  - Model `AiTestCase`; `src/services/ai/evals.ts`; AI Agent → "Automated tests" tab.
  - Each case: customer message + must include / must not include / expected action.
  - Runs in demo or live mode against the saved agent; nothing is sent and the CRM is untouched. Results are stored and logged as test interactions.
  - Rate-limited; audited as `ai.tests_run`.
- **Customer journey**
  - `src/services/crm/journey.ts` + a card on the contact page.
  - Stages: acquired → engaged → qualified → opportunity → customer → advocate.
  - Timeline built from real records: ads, landing forms, consent, conversations, flows, campaigns, automations, appointments, deals, purchases, loyalty, reviews, CSAT.
- **Sales forecast**
  - `salesForecast()`; Deals → "Sales forecast" panel.
  - Next 3 months by expected close date: best case, stage-weighted, and history-based (real 180-day win rate, only after 5+ closed deals).
  - Also: overdue deals, deals with no date, 6-month won history and run rate.
- **Security monitoring**
  - Admin → Security: failed sign-ins (24 h / 7 d / 14-day chart).
  - IPs flagged at 10+ failures in 24 h; accounts with failures; permission denials.
  - Sensitive actions (role changes, deletions, exports, key changes) and Super Admin sign-ins with a new-IP flag. All counted from the audit log.
- **Data export & workspace deletion**
  - Model `DataRequest`.
  - The owner downloads a full JSON export from Settings → Organization (secrets excluded, rate-limited, audited).
  - The owner requests deletion (exact name confirmation) with a 7-day cooling-off and can cancel.
  - A Super Admin executes it (via the existing `deleteClient`) or rejects it in Admin → Security. All steps are audited.
- Migration `20261119120000_ai_tests_data_requests`.
- Tests: `tests/integration/p3-features.test.ts` (7).

### Food ordering service (QR → WhatsApp → kitchen)
- New gated service `FOOD_ORDERING` (Admin → Clients → Services), nav “Food orders” (`/food`).
- Models `FoodSettings`, `MenuItem`, `DiningSpot`, `FoodOrder`; migration `20261121090000_food_ordering`.
- Public menu `/menu/<org>/<spot>` → draft order → guest sends “Confirm my order CODE” on WhatsApp → order placed,
  confirmation (+ Razorpay payment link for pay-now) sent back; inbound handled before automations/AI.
- Kitchen board with polling + sound, menu CRUD, rooms/tables with printable QR sheet, settings (secrets write-only,
  encrypted), report. Guest gets WhatsApp updates on every status change.
- Webhook `/api/webhooks/food/<orgId>` (HMAC verified, deduped) marks pay-now orders paid.
- Tests: `tests/integration/food-ordering.test.ts`; security sweep covers the new public routes.

### Sponsored placement (clients' ads on mecgura.tech)
- New gated service `SPONSORED_ADS`; models `SponsoredAd`, `SponsoredStat`; migration `20261123090000_sponsored_ads`.
- Flow: client draft → sends for review → Super Admin approves (Admin → Sponsored) → shown in the “Sponsored” panel beside blog articles
  (loaded client-side so cached pages still count views; bots are not counted; clicks counted once per visitor per 10 minutes).
- Safety: https-only links (no IPs/localhost/credentials), image sniffed (JPG/PNG/WebP ≤ 1 MB), edits to live ads go back to review,
  MECGURA pauses can't be undone by the client, global off switch, click redirect only to stored, reviewed links.
- Tests: `tests/integration/sponsored.test.ts` (6); security sweep lists the 3 public routes.

## 3. Pending external dependencies (nothing simulated)
| Item | Needed from Guri |
|---|---|
| Live AI (Claude or OpenAI) | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in Vercel, then Verify in Admin → Integrations readiness |
| Auto-pay | Razorpay Subscriptions enabled + `subscription.*` webhook events |
| Email | `RESEND_API_KEY` + `EMAIL_FROM` |
| Gemini / Maps | `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY` |
| Meta Marketing API, Google Business Profile, Google Ads | Provider approvals |
| Voice calling | Voice provider + DLT/consent (practice mode until then) |
| SMS | DLT registration (not implemented by design) |
| RCS | Google RBM approval (coming soon) |
| Food ordering pay-now | Each client's own Razorpay keys + `payment_link.paid` webhook |

## 4. Test results (this run)
- `npx tsc --noEmit`: pass
- `npx eslint src tests --quiet`: pass
- `npx vitest run`: **74 files, 609 tests passed**
- `next build`: compiled successfully
- Browser smoke: Integrations readiness, Admin auto-pay tab, contact journey, deals forecast, AI tests tab, data card and Admin security all render with no page errors and no mobile overflow.
