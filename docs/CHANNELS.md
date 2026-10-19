# Channels roadmap (design)

Today every conversation belongs to a `WhatsAppAccount`. To add email, Instagram, Messenger, web chat and voice without breaking WhatsApp, the next phases introduce a channel layer around the existing code instead of rewriting it.

## Model

* `Channel` kinds: `whatsapp`, `email`, `instagram`, `messenger`, `webchat`, `voice`.
* `ChannelAccount` (one per connected inbox: a WhatsApp number, an email address/domain, an Instagram account, a Page, a web widget, a phone line). WhatsApp keeps its own tables (`WhatsAppAccount`, connections, templates); a `ChannelAccount` row points at it (`kind = whatsapp`, `externalRef = whatsAppAccountId`).
* `ContactIdentity` (contactId, kind, value): phone, email, instagram id, page-scoped id. One contact, many identities; merge by explicit rule only (same verified phone or email).
* `Conversation` gets `channelAccountId` and `kind`; WhatsApp conversations are backfilled, nothing about them changes.
* `Message` stays as is (direction, type, body, attachments, status); channel-specific data lives in `payload`.

## Adapters

Each channel implements the same small interface:

* `ingest(request)`: verify the provider signature, turn the payload into `InboundMessage`s, dedupe by external id.
* `send(account, conversation, message)`: returns the provider message id or a failure with a user-safe reason.
* `rules(conversation)`: what the channel allows now (WhatsApp 24-hour window + templates; Instagram/Messenger 24-hour window + human-agent tag; email threads; web chat none).
* `fee(message)`: wallet category for MECGURA's per-message fee.

The inbox, assignment, notes, tags, AI agent, automations, analytics and wallet only depend on the interface. Campaigns and templates stay WhatsApp-only until a channel has an equivalent.

## Order of work

1. Introduce `ChannelAccount`, `ContactIdentity` and the adapter interface; wrap WhatsApp as the first adapter behind it (tests must stay green).
2. Email (outbound via Resend, inbound via the provider's inbound webhook, domain DNS guidance in the UI).
3. Web chat widget (public key per workspace, rate-limited, visitor identity by cookie).
4. Instagram DM and Messenger (Meta app review + Business Verification required for other businesses' accounts).
5. Voice (provider interface, call logs, summaries); live calls only with real provider credentials.

Every new channel is labelled "demo" until its credentials exist, never pretends to send, and has the same tenant-isolation and security-sweep tests as WhatsApp.

## Status

* Done: `ChannelAccount` and `ContactIdentity` tables; `Conversation.whatsappAccountId` is nullable with `channel`, `channelAccountId`, `subject`; email inbox (demo until a provider is configured, Resend for sending, normalised JSON inbound webhook at `/api/webhooks/channels/<secret key>`); `/channels` page; inbox shows channel and hides WhatsApp-only tools.
* Email limits today: plain text, no attachments, no wallet fee, no campaigns/templates/automations/AI on email chats (those stay WhatsApp-only and refuse cleanly).
* Contacts from non-phone channels store a placeholder in `phone` (`email:name@x.com`) because phone is the unique key; `ContactIdentity` holds the real identity.
* Web chat: public widget (`/widget.js`, `data-key` = inbox key) talking to `/api/webchat/<key>`; visitors are identified by a random id kept in the browser, which is also the only way to read their own thread; new visitors are rate-limited per IP.
* Messenger and Instagram DMs: Page/IG token verified with Meta on connect and stored encrypted; inbound through the same `/api/webhooks/meta` endpoint (objects `page` and `instagram`, `messaging` events); replies via `me/messages` inside the 24-hour window. Built and covered by tests against a mocked Graph API; **not yet verified against live Meta accounts** (needs a Page/IG account with a role on the Meta app, or app review + Business Verification for other businesses).
* AI calling (`/voice`): call records with goal, consent note, transcript, summary and outcome. No voice provider is connected (`liveVoiceProvider()` returns null), so every call is a clearly labelled **practice** call generated from a fixed script; nobody is phoned. A live provider plugs into `src/providers/voice/index.ts`. India: outbound calls need telecom-compliant numbers, consent and DND scrubbing; MECGURA only records consent and blocks opted-out/suppressed contacts.
