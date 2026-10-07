# Phase 4 — Inbox, Contacts (CRM) & Team

Campaigns and automation are intentionally **not** part of this phase.

## Pages

| Route | What |
| --- | --- |
| `/inbox` | 3 columns: conversation list (All / Unread / Assigned / Mine, search, filters) · thread · customer panel. On mobile it shows one pane at a time with a back button. Below `xl`, customer info opens in a drawer. |
| `/contacts` | Tabs: All / Customers / Leads / Opted in / Opted out / Suppression. Search, tag and lead filters, Add contact, Import CSV, Export CSV. |
| `/contacts/[id]` | Profile: details, suppression, consent (with evidence), notes, tags, custom fields, conversations, and an "Open chat" button. |
| `/team` | Members (add / role / remove), a roles & permissions matrix, and live agent availability. `/settings/team` redirects here. |

## Data model (Prisma; SQLite + Postgres schemas kept in sync)

The new models are `Contact`, `Tag`, `ContactTag`, `Conversation`, `Message`, `MessageAttachment`, `ConversationAssignment`, `ContactNote` and `ConsentRecord`. `OrganizationMember` also gains `agentStatus` and `agentStatusAt`.

Every row carries `organizationId`, and every query is scoped by `(id, organizationId)`. Production needs `prisma db push` (or a migration) against `schema.postgres.prisma`.

## API (all under `/api/organizations/{orgId}/`)

- `inbox/conversations` GET (tab, q, status, accountId) · POST (start a chat with a contact)
- `inbox/conversations/{cid}` GET · PATCH status (open / closed)
- `…/{cid}/messages` GET (cursor `before`) · POST (text, template, interactive buttons/list, image/video/audio/document by https link; supports `replyToId`)
- `…/{cid}/media` POST multipart upload · `…/{cid}/notes` POST internal note · `…/{cid}/read` POST · `…/{cid}/assign` POST (assign / claim / transfer / unassign)
- `inbox/attachments/{aid}` GET: an authenticated media proxy (streams from Meta and stores nothing)
- `inbox/demo/inbound`, `inbox/demo/status`: simulators, which only work on **demo** numbers
- `realtime` GET: Server-Sent Events stream
- `contacts` GET/POST · `contacts/{id}` GET/PATCH/DELETE · `/notes` · `/consent` · `/tags` · `contacts/import` (CSV ≤ 2 MB, ≤ 5000 rows) · `contacts/export`
- `tags` GET · `team` GET · `team/status` PUT

## Permissions

| Permission | Owner | Manager | Agent |
| --- | --- | --- | --- |
| inbox:read / reply / note / claim / transfer | ✓ | ✓ | ✓ |
| inbox:view_all (see every chat) | ✓ | ✓ | — (only their own + unassigned) |
| inbox:assign (assign to anyone) | ✓ | ✓ | — |
| contacts:read / write | ✓ | ✓ | ✓ |
| contacts:delete / import / export | ✓ | ✓ | — |
| team:status (own availability) | ✓ | ✓ | ✓ |

An agent must hold a chat before they can reply or close it. "Transfer" lets an agent hand over only their own chat.

## WhatsApp rules enforced server-side

- **24-hour window**: free-form messages are allowed only within 24 hours of the customer's last message. After that, only templates can be sent.
- Contacts that are opted out or suppressed are blocked from all outbound messages.
- Inbound `STOP` or `UNSUBSCRIBE` records an opt-out, and `START` records an opt-in. Both are written to the append-only `ConsentRecord` log.
- Delivery states only move forward (sent → delivered → read), and `failed` is terminal.
- The plan's monthly message and new-contact limits are enforced.

## Realtime

`/realtime` is an SSE stream with a heartbeat every 25 seconds, and events carry ids only. The client refetches only what changed and resyncs on reconnect, so there is no polling.

The default broker (`src/lib/realtime/broker.ts`) is **in-process**. For multiple instances or serverless deployments, plug in Redis pub/sub (or a similar service) with `setRealtimeBroker()`.

## CSV import format

The header row is required. Recognised columns are `name, phone, email, tags (; or | separated), lead_status, type (lead|customer), source, consent (opted_in|opted_out)`. Existing phones are updated.

Export escapes formula-injection characters (`= + - @`).

## Known limitations

- The real Meta send and receive path has only been tested with a mocked Graph API.
- Template management (sync and approval) and phone registration are not built yet, so template names must already exist in Meta.
- Media in demo mode is not stored. Real media is proxied from Meta on demand.
- No new environment variables were added in this phase.
