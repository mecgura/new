# Phase 11 — WhatsApp, SMS and email automation

One central, event-driven communication engine. Business modules never talk to a vendor; they report a fact ("appointment confirmed") and the engine decides **whether, how and when** to tell the patient.

```
business event → safeEmit() → clinic settings → patient + consent → template → channel → CommunicationMessage (QUEUED)
   → worker → provider adapter → SENT → webhook → DELIVERED / READ / FAILED → log → audit
```

## Honesty rules (absolute)
* **Nothing is faked.** A message is `SENT` only after a real provider accepted it, `DELIVERED`/`READ` only after a verified webhook says so. If a provider isn't configured the message is recorded as `SKIPPED` ("Not sent") with the reason; the UI never says "sent".
* The only stand-in providers in the repo are test doubles (`__setProvider`, `__setProviderFetch`) used by automated tests; application code never uses them.

## Providers (replaceable)
`src/lib/communications/providers/` — interfaces `WhatsAppProvider` (`sendTemplate`, `sendMessage`, `getMessageStatus`), `SmsProvider` (`sendSMS`), `EmailProvider` (`sendEmail`) and these adapters, selected by environment variable:

| Channel | `*_PROVIDER` | Env | Webhook |
|---|---|---|---|
| WhatsApp | `meta` (WhatsApp Business Cloud API) | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, optional `WHATSAPP_API_URL`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | `GET/POST /api/webhooks/whatsapp` (X-Hub-Signature-256) |
| SMS | `twilio` | `SMS_ACCOUNT_SID`, `SMS_API_KEY` (auth token), `SMS_SENDER_ID`, optional `SMS_API_URL` | `POST /api/webhooks/sms` (X-Twilio-Signature; uses `APP_URL`) |
| Email | `resend` | `EMAIL_API_KEY`, `EMAIL_FROM`, optional `EMAIL_REPLY_TO`, `EMAIL_API_URL`, `EMAIL_WEBHOOK_SECRET` | `POST /api/webhooks/email` (Svix signature + 5-minute replay window) |

Also: `CRON_SECRET` (scheduler endpoint), `COMMUNICATIONS_INLINE_WORKER=false` to disable the opportunistic in-process delivery. **Credentials live only in the server environment** — never in the database, client code, logs or the UI (screens show "configured / not configured" and a hint, nothing else). Provider error text is scrubbed of configured secrets before it is stored.

> The adapters follow each vendor's public API but have **not been exercised against live vendor accounts** in this repository (no credentials exist here). Request shapes, error classification and signature checks are covered by tests; do a first live send per channel in staging.

Tenant model: providers are platform-level (one set of credentials per deployment). Each clinic controls *whether* a channel is used, the sender display name, reply-to, language, reminder times, quiet hours, per-notification switches, fallback and caps; a clinic cannot read or change credentials, and never sees another clinic's data. (Per-clinic vendor accounts would need encrypted secret storage — not built.)

## Events
Wired: appointment requested / confirmed / rescheduled / cancelled / reminder; OPD check-in & your-turn (off by default); prescription available; lab report available (released only); follow-up planned / reminder / overdue; bill issued / due / overdue; payment received (receipt); portal account activated; account security alert (password changed, sessions ended, access reset); clinic announcement (marketing, opt-in only; no campaign tool). Not wired: patient-registered welcome, no-show, payment-failed (no gateway), lab sample/order events, OPD "consultation completed", generic document events.
Defaults ON: appointment messages, prescription, lab report, follow-up reminder, bill issued, payment, security. Defaults OFF (spam risk): OPD, follow-up created/overdue, bill due/overdue, announcements.

## Rules applied to every message
1. Clinic: a channel is on, the event is on, the clinic is active. 2. Provider configured for the channel. 3. Patient exists, not archived, has a number/email. 4. Patient channel preference (`NOT_ALLOWED` blocks; **WhatsApp requires `ALLOWED`**); category switches; withdrawn COMMUNICATION consent blocks everything except security; **marketing needs explicit channel opt-in + granted consent**. 5. Template exists (WhatsApp: only a clinic template with an *approved provider template name*). 6. Daily cap per patient/channel (security exempt). Only the **first eligible channel** in the clinic's order is used. Rules are checked again at send time.
* **Idempotency:** unique `(tenant, dedupeKey)` = business event + channel. Duplicate events, parallel calls and re-runs of the scheduler create nothing new.
* **Retries:** timeouts / network / 408 / 429 / 5xx retry with backoff 1 → 5 → 30 → 120 min up to the clinic's max (default 3); 4xx is permanent. Stuck `PROCESSING` rows are recovered.
* **Fallback** (e.g. WhatsApp → SMS) only when the clinic configured it, the patient allows the other channel, and the message failed for good.
* **Quiet hours** (clinic time zone): routine messages wait; HIGH/CRITICAL (reschedule, cancel, security) never wait. **Time zone** = the clinic's, never the browser's.
* **Failure isolation:** triggers run after the business transaction commits, only write queue rows, and swallow every error — a broken messaging layer never fails an appointment, prescription, report or bill (tested).

## Content safety
Built-in texts (English, Hindi, Punjabi for the main ones) contain names, dates, numbers and a link to the **authenticated** patient portal — never diagnoses, results, prescription contents, amounts of card data or credentials. Links carry ids only and require sign-in; there are no public document links. Email is responsive HTML in the clinic's branding (logo, colours, contact, footer; no MECGURA branding) and every value is escaped.

## Templates
Per clinic × channel × notification × language: DRAFT → ACTIVE (one live per combination) → INACTIVE/ARCHIVED. Editing a live template returns it to DRAFT. Variables are a fixed whitelist; `{{x}}` substitution only (no code). Validation: length per channel, email subject, unknown variables, stray braces, WhatsApp template name rules. Preview uses synthetic data and never sends. Language order: patient's choice → clinic default → English.

## Staff and roles
`communications.view` (admin, reception, doctor, accountant, lab — each sees only their groups: doctor = clinical, accountant = billing, lab = reports), `communications.resend` (reception, admin; transactional only, not security; ≤3 resends per message, 20/hour/user, re-checked against consent), `communications.templates` and `communications.configure` (clinic admin only). Super Admin: `/platform/communications` — aggregate delivery health, provider status, failure codes, no recipients or text.
Screens: Communications (stats, log with filters, details + resend), Templates, Settings → Communications, appointment dialog and patient file show real message status; portal → Notifications lists what was sent to the patient (no text), portal → Settings has language + honest channel availability.

## Scheduler
`POST|GET /api/internal/communications/run` with `Authorization: Bearer $CRON_SECRET` (off without the secret) queues due reminders then delivers due messages. Call it every minute from any cron (system cron, Vercel Cron, cloud scheduler). Reminders: appointment offsets (default 24 h; choices 30 min–2 days), never when the patient was booked inside the window, never after cancellation; follow-ups due today/tomorrow; optional overdue/bill nudges. Newly queued messages are also delivered immediately by a non-blocking in-process kick.

## Data
`CommunicationSettings`, `CommunicationTemplate`, `CommunicationMessage`, `CommunicationAttempt` (delivery history), `CommunicationWebhookEvent` (replay protection). Migration `20261012090000_phase11_communications` (SQLite + PostgreSQL). Audit: settings/template changes, message queued / sent / failed / retried / resent, rejected webhooks (ids and codes only — no text, no secrets).

## Not built / limits
* Live vendor verification (see note), per-clinic vendor accounts, OTP/login codes over SMS (no OTP flow exists), delivery of activation codes by message (codes are never put through the message log), marketing campaigns / bulk send, inbound conversations, WhatsApp CTA-button templates (links are in the body), push notifications, analytics — Phase 12+.
* Rate limiting uses the existing in-memory store (per server instance); use a shared store for multi-node.
