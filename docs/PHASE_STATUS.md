# MECGURA platform expansion: status

Single source of truth for the "complete platform" programme. Each stage is built, tested and deployed on its own so the
live product never breaks. Update this file at the end of every stage.

Legend: ✅ live and tested · 🟡 partly there · ❌ missing · 🔧 needs external setup (CONFIGURATION REQUIRED) · ⏳ coming soon by design

## Ground rules (from the brief, kept on every stage)

- Stack stays: Next.js 16, Prisma 7 (SQLite dev / Postgres prod), DB-backed scheduler (`src/services/scheduler.ts`,
  `Job`-style tables). No Redis: there is none in production, and adding one is a hosting change, not a feature.
- Every new client module: tenant-scoped queries, `requireOrgAccess` + permission, service gate where the module is sold
  separately, audit log, rate limit on writes, zod validation, tests (RBAC + tenant isolation via `security-sweep`).
- No fake data, no unofficial WhatsApp, no unsolicited bulk messages, SMS/RCS stay unavailable, Ads Manager stays
  approval-dependent, AI Calling stays practice mode until a provider is configured.

## Audit: brief vs. what exists (2026-11-04)

| # | Area | Status | What exists | Main gaps |
|---|------|--------|-------------|-----------|
| A | Landing page builder | ❌ | Admin edits MECGURA's own site (`/admin/site`) | Whole client builder |
| B | Advanced CRM | 🟡 | Contacts, tags, custom fields, lead status, notes, owner, import/export, bulk actions, consent | Deals + Kanban + custom stages, scoring rules, saved views, targets, merge, CLV |
| C | Automation engine | ✅/🟡 | Visual builder, 10 triggers, condition, delay, webhook, AI node, assign, versions, draft/publish, execution history per step, test runs, retries with backoff, loop protection, max depth, recovery (retry from failed step) | Switch node, human approval node, reusable components, execution analytics page |
| D | AI agent studio | 🟡 | Multiple agents, per-agent knowledge + txt/md/csv docs, actions (qualify/collect/book/transfer/summarise), handoff, interactions log | PDF/DOCX, website ingestion, OpenAI provider for agents, playground, prompt versions, feedback, token cost |
| E | Omnichannel inbox | 🟡 | WhatsApp + email + web chat + Messenger + IG, ContactIdentity, assignment, notes | SLA rules/alerts, CSAT, workload balancing, collision indicator, export |
| F | Campaign intelligence | 🟡 | Campaigns with delivery/read/reply stats, attribution, compliance checks, festival planner | A/B variants, cost/ROI, frequency caps, recommendations |
| G | Referral & loyalty | ❌ | — | Whole module |
| H | Reviews & reputation | 🟡 | "Feedback & Google review" automation | Review requests module, feedback form, history, analytics; GBP API 🔧 |
| I | Google Business & local | ❌/🔧 | — | GBP API needs Google approval 🔧; UTM builder can be built |
| J | Social media | 🟡 | Calendar, FB/IG scheduling + publishing, statuses | Approval workflow, AI captions/hashtags, media library, analytics |
| K | AI calling | 🟡 (practice) | Practice mode, transcripts, summaries | Queue/scheduling/consent/sentiment: keep practice until provider 🔧 |
| L | SaaS admin & revenue | 🟡 | Plans, subscriptions, invoices (GST), payments, wallet ledger, low balance alerts, agreements, KYC | MRR/ARR/churn dashboard, annual plans, trials, failed-payment recovery |
| M | Support & service health | 🟡 | Admin health page, audit log, webhook event log | Support tickets, provider health, failed jobs dashboard |
| N | Internal marketing | ✅ | Leads, tracking, calendar, AI images/copy, creative maker | — |
| O | Internal outreach | ✅ | Maps finder, email finder, one-by-one WhatsApp, email + unsubscribe | Suppression list view |
| 3 | Service entitlements | 🟡 | `OrganizationService` per client, gated modules (sidebar + API), plan feature keys, plan limits, usage counters | Per-feature beta flags, client "My services & usage" page |

## Build order (by value to clients and to MECGURA sales)

1. **B. CRM deals pipeline**: custom stages, Kanban, deal value/expected revenue, lead scoring rules (Hot/Warm/Cold)
2. **G. Referral & loyalty**
3. **H. Review requests & feedback**
4. **A. Landing page builder** (block-based, forms → CRM, WhatsApp button, QR, UTM, analytics)
5. **M. Support tickets** + service health
6. **L. Revenue analytics** (MRR/ARR/churn)
7. **F. Campaign A/B + ROI**
8. **E. Inbox SLA + CSAT**
9. **D. AI studio upgrades**
10. **J. Social approvals + AI captions**
11. **C. Switch / approval nodes, execution analytics**
12. Integrations screens marked 🔧 (GBP, Google Ads, Shopify, WooCommerce, Zapier/Make/n8n via existing API + webhooks)

## Stage log

_(newest last)_

### Stage 1: CRM deals pipeline ✅ (2026-11-04)
- Schema: `PipelineStage` (unique workspace+position), `Deal`, `DealActivity`, `OrganizationSettings.leadScoring`.
  Migration `prisma/migrations/20261106090000_deals`.
- Service `src/services/crm/deals.ts`: default stages created on first open, stage editor (reorder/rename/add/remove,
  one Won + one Lost, can't remove a stage with deals), deals CRUD with timeline, won → contact becomes customer,
  lost → contact lost (if nothing else open), Kanban board, stats (open value, weighted forecast, won/lost this month,
  90-day win rate, days to win, stuck >14 days, overdue, per-salesperson).
- Scoring `src/lib/lead-scoring.ts`: configurable rules (tag, status, source, opt-in, email, recent message, open deal
  value) → 0–100 → Hot/Warm/Cold thresholds.
- API: `/api/organizations/[orgId]/deals` (GET board, POST), `/deals/[id]` (GET/PATCH/DELETE), `/deals/stats`,
  `/deals/stages` (GET/PUT), `/deals/scoring` (GET/PUT). Permissions `deals:read|write|manage`.
- UI: `/deals` (sidebar "Deals"), `src/components/crm/deals-app.tsx`: drag-and-drop board + mobile "Move to" select,
  deal drawer with timeline and score reasons, stages and scoring editors, salesperson table.
- Tests: `tests/integration/deals.test.ts` (6) + security sweep auto-covers the new routes. Suite 471/471, build OK,
  browser smoke (desktop drag-drop + mobile) OK.
- Not in this stage (next CRM pass): saved views, duplicate merge, sales targets, CLV/repeat purchase.

### Stage 2: Referral & loyalty ✅ (2026-11-04)
- New gated client service `LOYALTY` ("Referral & loyalty") in `src/lib/catalog.ts`; sidebar "Loyalty"; every API
  route checks it (`src/services/loyalty/route-guard.ts`). Permissions `loyalty:read|write|manage`.
- Schema: `Purchase`, `LoyaltyEntry` (ledger, approved/pending/rejected, expiry), `LoyaltyReward`, `ReferralCode`,
  `Referral`, `OrganizationSettings.loyalty`. Migration `prisma/migrations/20261107090000_loyalty`.
- Rules `src/lib/loyalty.ts`: points per ₹100, welcome points, expiry days with FIFO expiry, tiers by lifetime points,
  referral code format `REF-XXXXXX`.
- Service `src/services/loyalty/loyalty.ts`: record purchase (points, customer lifecycle, pays referral on the friend's
  first qualifying purchase), redeem (serializable, can't overdraw), manual adjust with reason, rewards catalogue,
  referral codes + public link `/r/<orgId>/<code>` → client's WhatsApp with the code typed, referral captured from the
  customer's first message (`receiveInbound` hook), fraud flags (own code ignored, existing contact flagged, 10+/24h
  flagged; flagged never auto-paid), manual/auto approval, customer card (CLV, orders, avg gap, history), overview
  (members, 30-day sales, repeat rate, points given/redeemed/outstanding/expiring, lapsed 60+ days).
- UI `/loyalty` (`src/components/loyalty/loyalty-app.tsx`): Overview, Customers, Referrals, Rewards, Settings.
- Tests `tests/integration/loyalty.test.ts` (7). Suite 478/478, build OK, browser smoke OK.
- Retention/win-back: uses the existing "Drip: win back" automation (tag "Win back"); lapsed count shown on Overview.

### Stage 3: Reviews & reputation ✅ (2026-11-04)
- New gated client service `REVIEWS` ("Reviews & reputation"); sidebar "Reviews"; permissions
  `reviews:read|send|manage`; route guard `src/services/reviews/route-guard.ts`.
- Schema: `ReviewRequest` (token, location, status sent/failed/opened/rated, channel, rating, comment, escalated,
  resolved, Google click), `OrganizationSettings.reviews`. Migration `prisma/migrations/20261108090000_reviews`.
- Service `src/services/reviews/reviews.ts`: settings (locations with Google review links, message with {name}/{link},
  fallback approved template, low-rating threshold, cooldown), send requests (chat message inside the 24-hour window,
  approved template outside it, or "links only"; skips opted-out and cooldown), public feedback page `/f/[token]`
  (+ `POST /api/f/[token]`, `GET /api/f/[token]/google` counts the click and redirects), low ratings notify owners and
  managers and tag the contact "Unhappy customer", resolve with a note, stats (average, distribution, open/response/
  Google-click rates, 8-week trend, per location).
- Google policy: the Google review button is shown to every customer after they rate (no review gating).
- 🔧 Google Business Profile API (reading/replying to Google reviews, insights) needs Google's API access approval;
  not built yet. Review links work today without it.
- Tests `tests/integration/reviews.test.ts` (4) + sweep public list. Suite 482/482, build OK, browser smoke
  (team pages + phone feedback page) OK.

### Stage 4: Landing page builder ✅ (2026-11-04)
- New gated client service `LANDING_PAGES` ("Landing pages"); sidebar "Landing pages" → `/pages`; permissions
  `pages:read|manage`; route guard `src/services/landing/route-guard.ts`. Contact source `landing` added.
- Schema: `LandingPage` (draft blocks vs published blocks, theme, SEO, noindex), `LandingEvent` (view/click/submit
  with UTM + referrer), `LandingSubmission`, `LandingImage` (WebP bytes). Migration
  `prisma/migrations/20261109090000_landing_pages`. New dependency `qrcode@1.5.4`.
- Blocks `src/lib/landing.ts`: hero, text, features, services, pricing, image, YouTube video, testimonials, FAQ, lead
  form, CTA, QR, address & timings. Starters: blank, salon, clinic, real estate, coaching, restaurant.
- Service `src/services/landing/pages.ts`: CRUD, unique addresses, duplicate, publish checks (WhatsApp number,
  consent text, links), image upload (sharp → WebP ≤1600px), public page, view/click beacon, form → contact
  (create or update, tag, consent only when ticked, note, optional deal), honeypot, team alert, analytics (views,
  visitors, leads, conversion, sources, clicks, daily, latest entries).
- Public: `/p/<workspace-slug>/<page-slug>` (SEO metadata, OG, canonical, noindex option, floating WhatsApp, QR),
  `/api/lp/[id]/event`, `/api/lp/[id]/submit`, `/api/lp-image/[id]`. QR PNG download for the team.
- UI: list with 30-day stats + template picker (`pages-list.tsx`), builder (`builder.tsx`) with drag-and-drop block
  list, desktop/phone preview (container queries), block editor, page settings + SEO, publish/unpublish, analytics.
- 🔧 Custom domains per page need Vercel domain setup per client; not self-serve yet ("ask MECGURA").
- Tests `tests/integration/landing.test.ts` (6). Suite 488/488, build OK, browser smoke OK.

### Stage 5: Support desk + system health ✅ (2026-11-04)
- Schema: `SupportTicket` (global number from #1001, category, priority, status open/waiting/resolved/closed,
  SLA deadline, first response, escalation, assignee), `SupportMessage` (client/support, internal notes),
  `SupportAttachment` (PNG/JPG/WebP/PDF ≤5 MB, file signature checked). Migration
  `prisma/migrations/20261110090000_support`.
- Service `src/services/support/tickets.ts`: create (all roles, `support:use`), client reply reopens, client resolve,
  admin reply / internal note (first public reply stops the clock, client notified + emailed when email is set up),
  status/priority/assignee (priority moves an unanswered deadline), SLA targets urgent 2 h / high 8 h / normal 24 h /
  low 72 h, scheduler escalation once per breach to all Super Admins, 30-day report.
- Health `src/services/admin/system-health.ts`: database, scheduler, Meta app + webhook, numbers + low quality,
  messages/campaigns/automations/webhooks/API failure rates and p95, provider configuration (Claude, Gemini/OpenAI,
  Resend, Razorpay, Maps, voice), support backlog; latest failures list; "down" alerts to admins at most hourly
  (scheduler, every 15 min).
- UI: client `/support` ("Help & support" in the sidebar), admin `/admin/support` and `/admin/health`.
- Tests `tests/integration/support.test.ts` (5). Suite 493/493, build OK, browser smoke OK.

### Stage 6: Revenue analytics ✅ (2026-11-04)
- Builds on the existing billing overview (`src/services/billing/admin.ts`: monthly paid revenue, MRR split,
  receivables, failed payments, new/cancelled subscriptions), which stays as is.
- Service `src/services/billing/revenue.ts`: IST month windows, MRR per client at any moment, 12-month MRR trend,
  ARR, ARPA, MRR movements (new / expansion / contraction / churned, clients won/lost), client churn, revenue churn and
  net revenue retention (per month + 3-month average), renewal rate (renewal invoices, last 90 days), MRR by plan,
  revenue by client (paid invoices, 12 months), wallet ledger (top-ups, usage, refunds, corrections, 30 days),
  reconciliation (payment received but invoice open, amount differs, gateway-paid invoice without a payment).
- API `/api/admin/revenue`, `/api/admin/revenue/csv` (formula-injection safe, audited `revenue.exported`).
- UI `/admin/revenue` (admin sidebar "Revenue").
- Not built (needs billing-cycle changes, planned separately): annual plans, trials, automatic failed-payment retries.
- Tests `tests/integration/revenue.test.ts` (2). Suite 495/495, build OK, page smoke OK.

### Stage 7: Campaign intelligence ✅ (2026-11-04)
- Already existed and kept: compliance review with frequency cap (24 h), cost estimate vs wallet/package, delivery /
  read / reply / opt-out stats, quality signals, top error strings.
- Schema: `Campaign.abTemplateId/abVariables/abSplit`, `CampaignRecipient.variant`. Migration
  `prisma/migrations/20261111090000_campaign_ab`.
- A/B: version B = another approved template of the same category and WhatsApp account, sent to 10–50% of people
  (stable hash per phone); compliance checks B and its variables; sender uses B's template and pauses if it stops
  being approved; message payload records the variant.
- `src/lib/campaign-insights.ts`: variant assignment, two-proportion z-test (winner only with ≥100 per arm and
  p < 0.05), plain-language explanations of Meta error codes.
- `src/services/campaigns/insights.ts`: per-campaign A/B results, estimated cost (Meta rate per delivered + MECGURA fee
  per sent), attribution (deals opened ≤7 days, deals won and purchases ≤30 days), cost per reply/lead, ROI, grouped
  failure diagnostics, recommendations (best IST hour from 90-day read rates, winning version, opt-outs, replies);
  performance view comparing recent campaigns and templates.
- API `/campaigns/[cid]/insights`, `/campaigns/performance`. UI: wizard A/B option (template step) and B variables,
  report insights panel (cost & ROI, A/B, failures, next time), `/campaigns/performance`.
- Tests `tests/integration/campaign-ab.test.ts` (4). Suite 499/499, build OK, smoke OK.

### Stage 8: Inbox SLA, CSAT, collision warning, monitor, export ✅ (2026-11-04)
- Schema: `Conversation.waitingSince/slaAlertedAt` (+ index), `InboxResponse`, `CsatSurvey`, `ConversationPresence`,
  `OrganizationSettings.inboxSla`. Migration `prisma/migrations/20261112090000_inbox_sla`.
- `src/services/inbox/sla.ts`: a customer message starts the clock (first unanswered message only); any reply
  (agent, automation, AI, other channels) stops it and logs the wait. Scheduler alerts the assignee and managers once
  past the first-response target and can reassign to the least-busy online agent after N minutes (off by default).
  Demo chats are skipped.
- CSAT (off by default): closing a chat sends a 3-button "How did we do?" question; the tap is recorded against the
  agent and never triggers automations or AI replies.
- Collision warning: inbox heartbeat shows who else has the chat open or is typing.
- Inbox "Waiting" tab with wait badges; `/inbox/monitor` for owners/managers (waiting chats, breaches, per-agent
  response times and CSAT, SLA settings); transcript download (`contacts:export`, audited).
- Tests `tests/integration/inbox-sla.test.ts` (4). Suite 503/503, build OK, smoke OK.

### Stage 9: AI studio upgrades ✅ (2026-11-04)
- Schema: `AiAgentVersion`, `AiDocument.sourceUrl/syncedAt`, `AiInteraction.feedback/feedbackNote/feedbackById/feedbackAt`.
  Migration `prisma/migrations/20261113090000_ai_studio`. Dependency `unpdf@1.8.1` (PDF text layer).
- Knowledge files: PDF, Word (.docx), TXT, Markdown, CSV and HTML up to 10 MB (200 KB of text each); only the text is
  kept (`src/lib/doc-extract.ts`). Scanned/password PDFs and old .doc files get a clear message instead.
- Website pages: one public https page per document, fetched with the SSRF guard re-checked on every redirect,
  3 MB / 10 s limits, scripts/nav/footer stripped; Refresh re-reads it. Rate-limited 20/hour per workspace.
- Large documents: text beyond the fixed 60 K-character knowledge budget is no longer lost — passages that match the
  customer's latest messages are added per reply (outside the cached prompt).
- Versions: a copy of instructions/knowledge/actions/handoff is saved before each change (last 30); restore saves the
  current settings first so it can be undone.
- Reply feedback: 👍/👎 (+ note) on every AI reply in Activity, filter by rating; counts in usage.
- Usage & cost: per-agent calls, replies, handoff rate, errors, ratings, tokens and estimated cost in ₹ from list
  prices (`src/lib/ai-cost.ts`, `AI_USD_INR`, default 88). Demo replies cost nothing. Owners/managers only.
- Bug fixed: under Zod 4 `.partial()` still applied defaults, so a PATCH with only some fields reset the others
  (AI agent instructions/knowledge/actions/handoff, webhook description). New `partialNoDefaults()` helper.
- Not built: OpenAI as an alternative agent model (the agent stays on Claude; OpenAI/Gemini remain for images and ad
  copy in the admin studio). Multi-page website crawling (add pages one by one instead).
- Tests `tests/integration/ai-knowledge.test.ts` (8). Suite 511/511, build OK, browser smoke OK (real PDF upload).

### Stage 10: Social approvals, AI captions, media library ✅ (2026-11-04)
- Schema: `SocialPost.approvedAt/approvedById/reviewNote/submittedAt`, statuses `pending_approval` and
  `changes_requested`, `SocialAsset`, `OrganizationSettings.social`. Migration
  `prisma/migrations/20261114090000_social_approvals`. New permission `social:approve` (workspace owner).
- Approval workflow (`src/services/social/workflow.ts`), off by default; only the owner can switch it on or off.
  When on, a manager's (or MECGURA team's) scheduled post waits for the owner, who gets a notification and can
  approve or request changes with a note. Any edit needs a fresh approval. Unapproved posts can't be published,
  marked as posted, or picked up by the scheduler; posts scheduled before approval was switched on are held.
- AI captions (`src/providers/anthropic/social.ts`): 3 caption + hashtag options from a short brief in English,
  Hinglish, Punjabi (Roman or Gurmukhi) or Hindi, with tone, brand voice and always-included hashtags. It's told
  never to invent offers or claims. Without `ANTHROPIC_API_KEY` it says Configuration required. Rate limit 30/hour.
- Media library: up to 200 images / 150 MB per workspace, search by name or tag, pick into posts (the post keeps
  its own copy, so deleting from the library never breaks a scheduled post).
- Not built: post analytics (reach, likes). Needs Meta insights permissions on the connected Page. Marked 🔧.
- Tests `tests/integration/social-approvals.test.ts` (6). Suite 517/517, build OK, browser smoke OK.

### Stage 11: Automation Switch + Approval steps, branch analytics ✅ (2026-11-04)
- New steps in `src/lib/automations.ts` (validated in the API schema, builder, inspector, canvas):
  - **Switch**: one value (customer's message/last reply, name, custom field, lead status, source) → up to 8
    named cases (contains / equals / starts with; first match wins) + "Anything else".
  - **Approval**: the run pauses and owners/managers (or one named person) get a notification; they Approve or Reject
    with a note from Automations → Approvals, and the run continues on that branch. Timeout 1 h–7 days, then it is
    treated as approved or rejected (your choice). The owner can always decide; agents can't unless named.
- Schema: `AutomationApproval` (one per run+step). Migration `prisma/migrations/20261115090000_automation_approvals`.
- Engine: branch outputs generalised (`isBranching`, `handlesOf(type, data)`); the Approval step stays on itself
  while waiting and picks its branch on the decision or timeout; requests from stopped/finished runs are cancelled.
- Analytics: "Which way people went" — split per Condition / Switch / Approval step (live runs).
- Tests `tests/integration/automation-branching.test.ts` (6). Suite 523/523, build OK, browser smoke OK.
- Not built: reusable sub-flows ("components") — copy a step group with Duplicate for now.

### Stage 12: Integrations hub ✅ (2026-11-04)
- New page `/integrations` (owners/managers; nav → Workspace → Integrations).
- **Shopify — live.** Uses Shopify admin's own signed webhooks (Settings → Notifications → Webhooks), no app review.
  Order creation/paid → contact created or updated (source api, lifecycle customer), purchase recorded (loyalty
  points when Loyalty is on), tagged (default "Shopify customer"). Checkout creation without an order → tagged
  "Abandoned cart" with `{{contact.custom.cart_url}}` / `cart_total`; the order later removes that tag.
- **WooCommerce — live.** MECGURA generates the webhook secret (shown once). Order created/updated counted once
  the status is processing/completed/on-hold; the WooCommerce "ping" on save is answered.
- Every webhook is HMAC-SHA256 verified (constant-time); unknown connection and bad signature look the same (401).
  Secrets encrypted at rest. One record per order/cart (`IntegrationEvent` unique), so store retries and
  orders/paid after orders/create never double-count; a failed attempt is forgotten so the store's retry works.
  Store events never mark anyone as opted in to WhatsApp marketing. Rate limit 600/min per connection.
- **Zapier / Make / n8n — live** through the existing REST API (`/api/v1/contacts`…), automation Webhook trigger and
  signed outbound Webhooks; the page has the setup steps.
- **Google Business Profile, Google Ads — 🔧 Configuration required** (Google API approval / developer token);
  shown honestly with what works today instead.
- Schema `IntegrationConnection`, `IntegrationEvent`. Migration `prisma/migrations/20261116090000_store_integrations`.
  Public route `/api/integrations/[provider]/[cid]` added to the security sweep allowlist.
- Tests `tests/integration/store-integrations.test.ts` (5). Suite 528/528, build OK, browser smoke OK.

## Programme status after Stage 12 (2026-11-04)

| # | Area | Now |
|---|------|-----|
| A | Landing page builder | ✅ |
| B | Advanced CRM | ✅ deals, stages, scoring |
| C | Automation engine | ✅ + Switch, Approval, branch analytics |
| D | AI agent studio | ✅ (live AI 🔧 `ANTHROPIC_API_KEY`) |
| E | Omnichannel inbox | ✅ SLA, CSAT, collision, monitor, export |
| F | Campaign intelligence | ✅ A/B, ROI, recommendations |
| G | Referral & loyalty | ✅ |
| H | Reviews & reputation | ✅ (GBP API 🔧) |
| I | Google Business & local | 🔧 GBP / Google Ads approval; UTM ✅ |
| J | Social media | ✅ approvals, AI captions, library (insights 🔧) |
| K | AI calling | 🟡 practice mode until a provider 🔧 |
| L | SaaS admin & revenue | ✅ analytics; annual plans / trials / retries ❌ |
| M | Support & service health | ✅ |
| N | Internal marketing | ✅ |
| O | Internal outreach | ✅ |
| — | Integrations | ✅ Shopify, WooCommerce, Zapier/Make/n8n; Google 🔧 |

See `docs/LIVE_FEATURES.md` and `docs/CONFIGURATION_REQUIRED.md`.

### Stage 13: Annual plans, free trials, payment reminders ✅ (2026-11-04)
- Schema: `Plan.priceYearly/trialDays`, `Subscription.interval/periodPrice/trialEndsAt/trialReminderAt/pendingInterval`,
  `Invoice.remindersSent/lastReminderAt/targetInterval`. Migration `prisma/migrations/20261117090000_billing_annual_trials`.
  Defaults keep every existing plan and client exactly as before (monthly, no trial) until the admin sets them.
- **Yearly billing**: admin sets a yearly price per plan (hint shows the % saved). Clients toggle Monthly / Yearly.
  First plan → one invoice for the year; monthly → yearly charges the year less the unused part of the month;
  yearly → monthly waits for the end of the paid year. Renewals bill the period price. MRR uses the monthly
  equivalent (yearly ÷ 12).
- **Free trial**: admin sets trial days per plan. One trial per workspace (never trialled, never paid for a plan).
  No invoice during the trial; owners are told 3 days before it ends; at the end a new paid row starts with the
  first invoice (trial rows are 0 in MRR). Cancelling during the trial ends it with nothing to pay.
- **Payment reminders** (dunning): each sent once — 3 days before due, overdue, +3 days, final at +7 days — in-app
  for owners plus email when Resend is configured; a run that jumps ahead sends only the latest stage (no burst).
  Immediate "payment failed" notice was already there. True automatic card/UPI re-charging needs a Razorpay recurring
  mandate (🔧 not set up), so reminders carry the pay link instead.
- Tests `tests/integration/billing-annual-trial.test.ts` (7). Suite 535/535, build OK, browser smoke OK.

### Stage 14: Automation sub-flows ✅ (2026-11-04)
- New step **Run automation**: starts another published automation of the workspace for the same contact (a
  reusable "component"). "Wait until it finishes" (default) keeps the step until that run ends (woken by the child,
  hourly safety re-check, 7-day limit); a failed/stopped sub-flow fails the step so "If it fails" decides.
  Without waiting it just starts it and moves on.
- New trigger **Started by another automation** for components (never fires from events).
- Guards: an automation can't run itself or anything already in its chain (A → B → A stops at B), nesting ≤ 3
  levels, publish refuses missing/unpublished targets, one live run per contact per automation still applies, a
  crash mid-start adopts the already-started child instead of erroring, test runs skip the step.
- No schema change (uses the execution context). Tests `tests/integration/automation-subflows.test.ts` (5).
  Suite 540/540, build OK, browser smoke OK.

### Stage 15: AI reads a whole website ✅ (2026-11-04)
- Knowledge → Website page → "Read the whole website": from a start link, follows same-site https links and saves
  each page with real text as its own document (5 / 10 / 15 pages, within the 20-document limit).
- Respects robots.txt (`User-agent: *` Disallow), skips login/cart/account/search pages, files (PDF, images…),
  other websites and tracking parameters; every request goes through the SSRF guard; 45 s budget per run
  ("run it again to read more"); pages already in the knowledge base are skipped. Rate limit 5 runs/hour.
- Route `/ai/agents/[aid]/documents/crawl`. Tests `tests/integration/ai-crawl.test.ts` (4). Suite 544/544, build OK.
