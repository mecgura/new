# Live features (2026-11-04)

What clients can use today on mecgura.tech. "Gated" = switched on per client by Super Admin (Clients → Services).
Full build notes per stage: `docs/PHASE_STATUS.md`. What still needs keys/approvals: `docs/CONFIGURATION_REQUIRED.md`.

## Client workspace
- **Inbox** (WhatsApp + email + web chat + Messenger + Instagram): assignment, notes, Waiting tab with first-response
  SLA alerts and auto-reassign, CSAT after closing, "someone else is typing" warning, transcript download, supervisor
  monitor.
- **Contacts & Deals**: custom fields, tags, consent, import/export, deals Kanban with custom stages, lead scoring
  (Hot/Warm/Cold).
- **Campaigns** (gated WhatsApp automation): compliance review, frequency cap, cost estimate, A/B testing with a
  significance check, ROI and attribution, failure explanations, recommendations, performance page.
- **Automations**: visual builder with 12 step types incl. **Switch** (many paths) and **Approval** (owner/manager
  decides), drip templates, versions, test runs, retries, logs, analytics with branch split.
- **AI Agent** (gated): knowledge from FAQs, PDF/Word/TXT/CSV/HTML files and website pages, relevant-passage search
  for big documents, versions with restore, 👍/👎 on replies, usage & estimated cost. *Live AI needs
  `ANTHROPIC_API_KEY`.*
- **Loyalty & referrals** (gated), **Reviews** (gated), **Landing pages** (gated, forms → CRM, QR, UTM, analytics).
- **Social media** (gated): calendar, Facebook/Instagram publishing, owner approval workflow, AI captions in
  English/Hinglish/Punjabi/Hindi, media library.
- **Integrations**: Shopify & WooCommerce (orders, purchases, abandoned carts), Zapier/Make/n8n via API + webhooks.
- **Help & support** tickets with SLA; API keys; outbound webhooks; billing, wallet, invoices; agreements & KYC.

## Super Admin
Clients & services, plans & billing, revenue analytics (MRR/ARR/churn/movements, CSV), support desk, system health
with alerts, WhatsApp accounts, marketing (leads, calendar, AI creatives), outreach (Maps finder, email finder,
one-by-one WhatsApp), site editor.

- **Billing**: monthly or yearly plans, free trials, payment reminders before and after the due date.

## Not built yet (on the list)
Automatic card/UPI re-charging (needs a Razorpay recurring mandate); reusable automation sub-flows; multi-page
website crawling for AI; OpenAI as an alternative AI-agent model.
