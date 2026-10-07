# Phase 8 — Multiple numbers, public API, webhooks

## Multiple WhatsApp numbers

- A workspace can connect several numbers, up to the plan's limit. The limit was already enforced; the 4th number on a 3-number plan is refused with the plan message.
- A number belongs to exactly one workspace: `phoneNumber` is unique platform-wide.
- **Switch from the dashboard:** the number switcher (shown with 2 or more numbers) sets a per-browser preference, the `mecgura_number` cookie.
  - The cookie value is `<orgId>.<accountId>`, so a value left over from another workspace is ignored.
  - `PUT /api/organizations/:org/whatsapp/active` validates the number against the workspace and is audited.
- The dashboard now shows **real** numbers, not placeholders. They are scoped to the chosen number, or to all numbers: open conversations, messages sent and received (30 days), contacts, campaigns and automation runs. A per-number table sits below them.
- **Inbox:** filters by number, and defaults to the active number. The same customer gets one thread per number.
- **Campaign:** selects its sending number, and new ones default to the active number. The number is validated server-side, in both create and update.
- **Automation:** selects its number. This phase **fixed a bug found by the new test**: an automation bound to number A also reacted to messages arriving on number B. It now only reacts to its own number. Contact-level triggers (new contact, tag, lead status) are not number-specific.

## API (`/api`)

Tabs: **API keys**, **Documentation**, **Usage**, **Logs**.

### Keys
- Format `mgk_` + 256 random bits. Only a SHA-256 hash and a 12-character prefix are stored.
- The full secret is returned **once**, by create or rotate. It is never listed, logged or audited.
- Permissions are scopes: `numbers:read`, `contacts:read`, `contacts:write`, `conversations:read`, `messages:read`, `messages:send`, `templates:read`. A request needs exactly the scope its endpoint requires, and editing permissions applies to the next request.
- Create, rename/permissions, **rotate** and **revoke**.
  - Rotate makes a new secret with the same name and permissions.
  - The old key is revoked now, or after a grace period of 1, 24 or 72 hours.
  - Optional expiry: 30 days, 90 days, 1 year, or never.
- **Last used:** time and a masked network address.
- At most 10 active keys per workspace.
- Only **owners** create, rotate or revoke keys (`api:manage`). Owners and managers can read the list, usage and logs (`api:read`).

### Authentication and security (`src/lib/api-auth.ts`)
- Order of checks:
  1. Refuse IPs that keep sending bad keys.
  2. `Authorization: Bearer` only. A key in the URL is never accepted.
  3. Hash lookup.
  4. Key not revoked or expired, and workspace active.
  5. The endpoint's scope.
  6. Per-key rate limit.
  7. Run the handler.
- **Tenant:** the workspace comes only from the key. Handlers never read an organisation id from the request, so cross-tenant ids return 404.
- **Rate limit:** 120 requests per minute per key, with `X-RateLimit-Limit/Remaining/Reset`, and 429 with `Retry-After`.
- **Brute force:** 20 failed keys per minute from one IP blocks that IP for a minute.
  - The limiter is in-memory per instance, as noted in `rate-limit.ts`. Use Redis for a hard multi-instance limit.
- **Logs** hold method, path (no query), status, duration, a **masked** IP (203.0.113.7 → 203.0.113.0), a truncated user agent and the error code.
  - They never hold bodies, queries, headers or keys. This is tested.
  - They are kept 30 days. Unauthenticated requests aren't logged against any workspace.
- `X-Request-Id` on every response matches the log row. `Cache-Control: no-store`.
- **Marketing templates** need recorded opt-in, and consent via the API needs written evidence. The public API cannot set suppression, owner or source.
- Sending uses the same rules as the inbox: consent, suppression, the 24-hour window, template approval and plan limits.
  - Messages carry `origin: "api"` and don't make the AI agent step back.
  - With several numbers, `number_id` is required. It is never guessed.

### Endpoints (`/api/v1`)
`GET me` · `GET numbers` · `GET templates` · `GET/POST contacts` · `GET/PATCH contacts/:id` · `GET conversations` · `GET conversations/:id/messages` · `POST messages`. See the Documentation tab for examples. It lists only endpoints that exist.

## Webhooks (`/webhooks`)

- Endpoint = HTTPS URL + chosen events (10 per workspace, owners and managers).
- The URL is checked when saved **and again at send time** (SSRF / DNS-rebinding guard).
  - Refused: http, credentials in the URL, localhost, `.internal`, private and loopback ranges.
  - Redirects are not followed.
- **Events:** `message.received`, `message.sent`, `message.delivered`, `message.read`, `message.failed`, `contact.created`, `contact.updated`, `conversation.created`, `campaign.completed`, `flow.submitted`.
  - Payloads are `{ id, type, created_at, organization_id, data }`.
  - Outbound message events never repeat the message text.
- **Signature:** `X-Mecgura-Signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<raw body>")>`.
  - The docs give Node and Python verifiers, with a 5-minute replay window and a constant-time compare.
  - The signing secret is `whsec_…`, shown once, stored AES-GCM encrypted, and can be rolled.
- **Delivery:**
  - Timeout 10 s.
  - Any non-2xx answer or timeout is retried after 1 min, 5 min, 30 min, 2 h and 6 h (6 attempts in total).
  - `410` stops at once.
  - The same event id and body are used on every retry.
  - 10 failed deliveries in a row switch the endpoint off and notify owners and managers.
- **Test:** the **Send test** button sends a signed `webhook.test`. It never counts as a failure.
- **Re-send:** a failed delivery can be re-sent for 7 days.
- **Data minimisation:**
  - A delivered event's payload is deleted straight away.
  - Failed payloads are kept 7 days, then dropped.
  - Delivery rows are removed after 30 days.
  - Response bodies are never read or stored.
- **Hooks:**
  - `transmit` and `applyStatusUpdate` for message events.
  - `receiveInbound` and `startConversation`.
  - Contact create, update and import.
  - Campaign completion, and Flow submission.
  - Hooks are no-ops (a cached lookup) for workspaces without a subscriber.
- The scheduler's `runDueWebhooks` handles retries and housekeeping, called from the existing cron tick.

## Data
New models: `ApiKey`, `ApiRequestLog`, `WebhookEndpoint`, `WebhookDelivery`. Migration `20261006163359_phase8_api_webhooks`; `schema.postgres.prisma` is kept identical. No new environment variables.

## Tests (`tests/integration/api-webhooks.test.ts`, 29)
- **Multiple numbers:**
  - plan limit and tenant-unique numbers;
  - one thread per number;
  - inbox filter, including a foreign number id;
  - active-number switch validation;
  - campaign number, including a foreign number;
  - automation applies only to its own number.
- **API auth:** owner-only keys, one-time secret and hash-only storage, missing/malformed/query-string keys, scopes, revoke, expiry, suspended workspace, rotation with and without grace, rate limit and brute-force block, and a log-leak test.
- **Public API:** contacts and consent evidence, `number_id` rules, sending, approved-template and marketing-consent rules, and tenant isolation in both directions.
- **Webhooks:**
  - URL safety and secret handling;
  - all ten events delivered, signed and verified, with subscribers only and payloads cleared after delivery;
  - retries and give-up, re-send, 410, redirects and auto-disable;
  - private-at-send-time refusal;
  - test button and secret rotation;
  - tenant isolation, purge, and the endpoint limit.
