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
