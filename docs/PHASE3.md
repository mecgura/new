# MECGURA platform — Phase 3: WhatsApp Connection Center

## Routes
| URL | Who | Purpose |
|---|---|---|
| `/dashboard/whatsapp` | all members | Connection Center: 3 options, numbers, plan slots |
| `/whatsapp/connect?method=meta\|existing\|developer` | owner | Meta Embedded Signup (+ demo), coexistence, API/developer setup |
| `/whatsapp/accounts` | all members | One card per number (multiple numbers supported) |
| `/whatsapp/accounts/[id]?tab=overview\|webhook\|settings` | members (webhook/settings: owner) | Manage, webhook info, rename, disconnect |
| `/api/webhooks/meta` | Meta | GET verification + signed POST events |

## Architecture
```
UI (src/app, src/components/whatsapp)   ── no Meta logic, calls APIs only
API routes /api/organizations/[orgId]/whatsapp/**  ── auth + tenant + permission + validation
Service layer  src/services/whatsapp/   ── orchestration, persistence, audit, notifications
Provider       src/providers/meta/      ── Graph API client, Embedded Signup exchange, webhook signature/parsing, demo data
```
Permissions: `whatsapp:read` (owner, manager, agent), `whatsapp:manage` (owner). The client's
**WhatsApp Automation** service must be enabled and the plan must have a free number slot.

## Data model
`WhatsAppBusinessAccount` (WABA) → `PhoneNumber` (Meta mirror) → `WhatsAppAccount` (MECGURA card,
extended from Phase 2) ← `WhatsAppConnection` (method, status, encrypted credentials) →
`WebhookConfiguration` (callback, verify token, status). `WebhookEvent` stores raw events (idempotent).

## Connection methods
* **Meta Embedded Signup** — `start` creates a single-use, 15-minute, org-bound state; the browser
  runs FB.login (config_id, response_type=code); `complete` exchanges the code server-side, verifies the
  WABA/number, subscribes the app to the WABA and stores the token encrypted. Returns 503 until
  `META_*` is configured — never faked.
* **Existing WhatsApp Business** — same flow with Meta's coexistence feature type. Eligibility is decided by Meta.
* **API / developer** — WABA ID, Phone Number ID, access token (+ optional app secret) are verified with
  Meta before saving; a per-connection webhook verify token is issued.
* **Demo** — fictional ids (`DEMO-…`, +1 202-555-xxxx), status `demo`, no Meta calls. Available while Meta
  isn't configured (or `WHATSAPP_DEMO_MODE=on`); disabled with `WHATSAPP_DEMO_MODE=off`.

## Security
* Access tokens / app secrets / verify tokens: AES-256-GCM (`WHATSAPP_ENCRYPTION_KEY`, required in production).
  APIs return only `••••last4`. Tokens are sent to Meta only in the `Authorization` header.
* Disconnect unsubscribes the webhook at Meta (best effort) and **wipes** stored credentials.
* Webhook GET: platform or per-connection verify token (constant-time compare). POST: `X-Hub-Signature-256`
  HMAC must match MECGURA's app secret or the connection's own app secret; 1 MB limit; events de-duplicated.
* A WABA / number can belong to only one client.

## Not in this phase
Inbox / conversations, sending messages, templates, phone-number registration (PIN) and display-name
management. Webhook processing currently updates counters, quality/limit tier and stores events.

## Go-live checklist (Meta)
1. Meta app with WhatsApp product, Business verification, Tech Provider / Embedded Signup configuration → `META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_SIGNUP_CONFIG_ID`.
2. Set `META_WEBHOOK_VERIFY_TOKEN`, callback `https://<domain>/api/webhooks/meta`, subscribe the fields listed above.
3. Add the production domain to the app's allowed domains for the JS SDK.
4. Set `WHATSAPP_ENCRYPTION_KEY` (keep a secure backup — losing it makes stored tokens unreadable).
5. `PRISMA_SCHEMA=prisma/schema.postgres.prisma npx prisma db push` (back up first).
