# Phase 5: Templates, Campaigns & Quality Center

This phase is **compliance assistance only**. MECGURA uses only the official WhatsApp Cloud API. It contains:

- no anti-ban or limit-bypass logic
- no WhatsApp Web automation
- no number rotation

## Pages

| Route | What |
| --- | --- |
| `/templates` | Template library. Tabs: All / Draft / Pending / Approved / Rejected. Filters: category, account, search. "Sync from Meta" button for live accounts. |
| `/templates/new`, `/templates/[id]` | Editor fields: account (WABA), name, category (Marketing / Utility / Authentication), language, header (none, text, image, video, document), body with `{{n}}` variables, sample values, footer, and buttons (quick reply, website with optional `{{1}}` suffix, call). Shows a live WhatsApp preview and a review-readiness panel. Actions: save draft, submit, duplicate, delete. Demo accounts get Approve/Reject (demo) buttons. |
| `/campaigns` | Campaign list with status tabs and per-campaign results, plus saved segments. |
| `/campaigns/[id]` | A draft opens the **7-step wizard**: details, audience, template, variables, schedule, compliance review, send. Any other status opens the **report**: live stats, recipients, quality signals, failure reasons, the compliance snapshot taken at launch, pause/resume/cancel, and the demo simulator. |
| `/whatsapp/quality` | Quality Center (owners and managers). Shows account status, messaging quality and limit per number, opt-in coverage, 30-day opt-out and failure rates, template status, campaign and account alerts, and the audit log. |

## Data model

The SQLite and Postgres schemas are kept in sync.

- `MessageTemplate`: one row per WABA + name + language. Fields: status `draft | pending | approved | rejected | paused | disabled`, Meta id, raw Meta status, rejection reason, quality score.
- `Segment`: saved audience filters. Filters are re-evaluated every time a segment is used.
- `Campaign`: audience, variable mapping, schedule, compliance snapshot.
- `CampaignRecipient`: one per phone per campaign. Tracks status, the resolved variables, and links to the inbox `Message`. Timestamps: sent, delivered, read, failed, replied, opted out.
- `WhatsAppBusinessAccount` gains `accountStatus`, `lastAccountEvent` and `lastAccountEventAt`.

Production must apply migration `20261006104949_phase5_templates_campaigns`, or run `prisma db push` with `schema.postgres.prisma`.

## Meta submission architecture

- **Submit:** `POST /{waba-id}/message_templates` with the generated components (`src/lib/templates.ts → toMetaComponents`).
  - Media headers upload a sample through the Resumable Upload API (`/{app-id}/uploads`) to get the `header_handle`. The sample file is sent to Meta only; MECGURA does not store it.
  - Templates that Meta rejected are corrected in place with `POST /{template-id}`.
- **Review result:** arrives by webhook.
  - `message_template_status_update` → approved / rejected / paused / disabled
  - `message_template_quality_update` → quality score
  - `template_category_update` → category change
  - `account_update` → account notice
- **Sync:** imports or refreshes every template on a live WABA (`GET /{waba-id}/message_templates`).
- **Delete:** also deletes the template on Meta (`DELETE …?hsm_id=`).
- **Demo accounts:** nothing leaves MECGURA. The template goes to "pending", and a team member chooses the review outcome explicitly.
- **Sending:** the inbox and campaigns can only send **approved** library templates. Every variable must have a value, and WhatsApp's parameter rules apply (no line breaks, at most 4 spaces in a row, https links for media).

## Compliance review (step 6, re-run at launch)

Checks:

- **Approved template:** must be on the sending number's WABA. Authentication templates can't be broadcast.
- **Sending number:** must be connected. A warning shows when Meta rates quality YELLOW or RED.
- **Consent verified:** only `opted_in` contacts are sent to.
- **Opted-out removed.**
- **Suppression checked.**
- **Duplicates removed:** by phone number.
- **Invalid contacts removed:** bad E.164 numbers, the business's own number, or foreign/deleted ids.
- **Variables validated:** each contact's resolved values are checked.
- **Marketing frequency:** for marketing templates, anyone who got another marketing campaign in the last 24 h is removed.
- **Plan message limit:** applies to live numbers.
- **Messaging-limit tier:** shows a warning only.

The review shows **Total / Eligible / Removed**, a breakdown by reason, and a sample of removed contacts.

Sending requires an explicit consent confirmation, which is written to the audit log. The recipient list is frozen at launch. Consent is **re-checked for each contact right before its message is sent**, so anyone who opted out after scheduling is skipped.

## Suppression & consent

- An inbound STOP / UNSUBSCRIBE / "Stop promotions" message (text or button) sets the contact to `opted_out` and appends a `ConsentRecord`. In this codebase "opted_out = true" is `optInStatus = "opted_out"`.
- Future campaigns exclude these contacts, and the full consent history is kept.

## Sending engine

- `processCampaign` claims each recipient atomically, so overlapping workers never double-send. Each message is a real inbox message in the customer's thread, and replies go to the Inbox.
- The campaign pauses automatically if the template stops being approved or the number disconnects.
- Pause, resume and cancel all work.
- **Send now** runs right after the response (`after()`).
- **Scheduled** campaigns:
  - Self-hosted (`next start`): an in-process scheduler (`src/instrumentation.ts`) checks for due campaigns once a minute. Set `CAMPAIGN_SCHEDULER=off` to disable it.
  - Serverless (Vercel): call `GET /api/cron/campaigns` every minute with `Authorization: Bearer $CRON_SECRET`. The route returns 503 until `CRON_SECRET` is set.
- **New env vars (names only):** `CRON_SECRET`, `CAMPAIGN_SCHEDULER`.

## Analytics

- **Metrics:** sent, delivered, read, failed, replies and opt-outs, all computed live from recipient rows.
- **Attribution:** replies and opt-outs count towards a campaign when the customer quotes the campaign message (button replies always do), or when the reply comes within 72 h of it.
- **Quality signals:** failure rate, opt-out rate, read rate, template quality, number quality and messaging limit, plus the top failure reasons.
- **Live updates:** the report updates over SSE (`campaign.updated` events). It does not poll.

## Demo mode

On a demo number the full flow works end to end:

1. Create a template, submit it, and approve it with the demo review.
2. Build the campaign, run the review, and send.
3. Use the report's **Demo simulator** to feed delivered, read and failed receipts, replies, and STOP opt-outs through the same code paths a live Meta webhook uses.

Nothing is delivered to WhatsApp in demo mode.

## Permissions

| | Owner | Manager | Agent |
| --- | --- | --- | --- |
| View templates / campaigns | ✓ | ✓ | ✓ |
| Create & submit templates (`templates:manage`) | ✓ | ✓ | — |
| Build & send campaigns (`campaigns:manage`) | ✓ | ✓ | — |
| Quality Center (`quality:read`) | ✓ | ✓ | — |
| Refresh number health from Meta (`whatsapp:manage`) | ✓ | — | — |

## Known limitations

- The live Meta paths (template submit/sync/delete, the sample upload, campaign sends and the webhooks) are tested only against a mocked Graph API.
- With multiple server instances, realtime needs a shared broker (see `src/lib/realtime/broker.ts`).
- Sending is sequential within a worker, which is well under Meta's default throughput. For very large lists, run the cron every minute; each tick continues where the last one stopped.
- Template edits on **approved** templates are done by duplicating the template (Meta limits edits of approved templates).
- Automations are not part of this phase.
