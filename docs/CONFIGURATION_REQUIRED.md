# Configuration required

Features that are built and tested but need an outside account, key or approval before they work for real.
Until then the app says so on screen ("Configuration required") — nothing pretends to work.
Checked against the production project's environment variable **names** on 2026-11-04 (values never read).

## Keys you can add yourself (Vercel → mecgura-wa → Settings → Environment Variables → redeploy)

| Variable | Status in production | What turns on |
|---|---|---|
| `ANTHROPIC_API_KEY` | ❌ not set | Live AI agent replies, AI step in automations, AI summaries, AI social captions. Without it: demo AI on demo numbers only, captions show "Configuration required". Optional `AI_MODEL` (default `claude-haiku-5-5`), `AI_USD_INR` (cost estimates, default 88). |
| `RESEND_API_KEY` + `EMAIL_FROM` | ❌ not set | Sending email: password reset, invoices by email, outreach email, email channel replies. **Recommended soon** — without it, forgotten-password emails can't go out. |
| `GEMINI_API_KEY` and/or `OPENAI_API_KEY` | ❌ not set | Admin AI studio images and ad copy (marketing). |
| `GOOGLE_MAPS_API_KEY` | ❌ not set | Admin outreach: Google Maps prospect finder. |
| `META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN` | ✅ set | WhatsApp Cloud API, embedded signup, Messenger/Instagram. |
| `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | ✅ set | Payments and wallet top-ups. |
| `WHATSAPP_ENCRYPTION_KEY`, `AUTH_SECRET`, `CRON_SECRET` | ✅ set | Encrypted credentials (WhatsApp, channels, store integrations), login, scheduler. |

## Needs an approval or a provider (not just a key)

| Feature | What's needed | What works today instead |
|---|---|---|
| Google Business Profile (read/reply to Google reviews, insights) | Google Business Profile API access approval for MECGURA | Reviews module: private feedback + Google review link |
| Google Ads sync / offline conversions | Google Ads developer token + OAuth app review | UTM links on landing pages, campaign ROI attribution |
| Social post analytics (reach, likes) | Meta `pages_read_engagement` / `instagram_manage_insights` on the app | Publishing, approvals, calendar |
| AI Calling (real calls) | A voice provider account (e.g. telephony + speech) and DLT/consent setup | Practice mode with transcripts and summaries |
| SMS | DLT registration (sender ID, templates) | Unavailable by design |
| RCS | Google RBM partner approval | Coming soon by design |
| Ads Manager (create/launch ads) | Meta Marketing API advanced access | Approval-dependent, as before |
| Custom domains for landing pages | Per-client domain setup on Vercel | Pages on mecgura.tech/p/… |
| Auto-pay (card / UPI AutoPay) | **Razorpay Subscriptions** enabled on the MECGURA Razorpay account (Dashboard → Subscriptions; Razorpay may ask for activation), and on the existing webhook (`/api/webhooks/payments/razorpay`) tick the `subscription.*` events: authenticated, activated, charged, pending, halted, cancelled, completed, paused, resumed. Which methods appear (card, UPI AutoPay, eMandate) depends on what Razorpay enabled. | Pay-now links + payment reminders. Until enabled, “Turn on auto-pay” shows Razorpay's own error. |

## Store integrations (no approval needed)
Shopify and WooCommerce use the store's own signed webhooks — the client connects them in **Integrations** and
pastes one URL (and, for Shopify, the signing key). Nothing to configure on the MECGURA side.
