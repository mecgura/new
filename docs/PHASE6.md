# Phase 6 — Visual automations

## Pages

| Route | Contents |
| --- | --- |
| `/automations` | Automation list with status tabs, search, runs/completed/failed (last 30 days) and last run. Actions: Create (blank or the demo template), Edit, Duplicate, Activate / Deactivate, View logs, Analytics, Delete. |
| `/automations/:id` | Builder (React Flow `@xyflow/react`) plus Logs / Analytics / Versions tabs. Agents get a read-only view. |

**Builder features**
- Zoom and pan; mini-map and zoom controls; dot grid.
- Undo / redo: toolbar buttons or Ctrl+Z / Ctrl+Shift+Z, 100 steps.
- Save (Ctrl+S) stores the draft. Publish creates a new version, and the draft never affects live runs.
- Test: runs the draft for one contact. Delays can be skipped and the run is followed live in the run drawer, with the active step highlighted on the canvas.
- Versions: list of published versions, with "restore to draft".
- Logs and Analytics tabs.
- "Step stats" toggle shows done / failed / waiting counts on each node.
- Live validation panel; problems are shown on the nodes themselves.
- Palette: click a step to add it after the selected one (auto-connected), or drag it onto the canvas.
- On mobile, steps are added from the toolbar menu, and step settings open in a drawer.

## Nodes

| Node | What it does |
| --- | --- |
| Trigger | One per flow (see triggers below). |
| Message | Text, or up to 3 reply buttons. Personalisation: `{{contact.first_name}}`, `{{contact.custom.city}}`, `{{reply}}`, `{{ai.response}}`. Optionally **waits for the reply** (1 min – 7 days). Outside the 24-hour window it sends the **fallback template**; if none is set, the step fails. |
| Template | Sends an approved template, with variables mapped from contact fields. Marketing templates require a recorded opt-in. |
| Delay | Waits 1 minute to 30 days. |
| Condition | Yes / No branches. Operators: contains (comma list = any), equals, not equal, starts with, ends with, empty / not empty. Fields: customer's message, contact name / email / phone / custom field, tag, lead status, source, consent, date and time (IST). Match: all or any. |
| Tag | Adds or removes a tag. |
| Assign agent | Assigns to a specific person, or to the least-busy agent (online first, then fewest open chats). Leaves a system note and a notification. |
| Update contact | Sets lead status, lifecycle, name, email or a custom field. Supports `{{reply}}`. |
| Webhook | POSTs JSON (contact, trigger, reply) to an https URL. Private and internal addresses are blocked (SSRF guard). Redirects are not followed. Uses an `X-Mecgura-Idempotency-Key` header. |
| AI response | Claude (`claude-opus-5-5`, low effort, server-side refusal fallback) writes a short reply from the business's instructions plus the recent chat. It can send the reply and/or save it to a field. Needs `ANTHROPIC_API_KEY`; without it the step fails with a clear message. |
| End | Ends the run. |

## Triggers

| Trigger | Fires when |
| --- | --- |
| New contact | A contact is created. Sources can be filtered; CSV import is off by default. |
| Incoming message | Any inbound message. |
| Keyword | The message matches a keyword (exact, contains or starts with). |
| Button click | The customer taps a button, optionally a specific one. |
| Template reply | The customer replies to a template, optionally a specific one. |
| Flow submission | A WhatsApp Flow `nfm_reply` arrives. |
| Webhook | An inbound request hits `POST /api/automations/hooks/:id` with `Authorization: Bearer <secret>`. The secret is shown once and only its hash is stored. |
| Schedule | Daily or on chosen weekdays at an IST time, once per contact with a chosen tag (max 1,000 per run). |
| Tag added | A tag is added to a contact. |
| Lead status | A contact's lead status changes. |

A message that answers an automation waiting for a reply resumes that automation and does **not** start new ones. **STOP** stops all of the contact's queued and running automations.

## Execution engine

- **Models:**
  - `Automation` holds the draft graph, status, the published version pointer, and the denormalised trigger used for fast matching.
  - `AutomationVersion` holds each published graph.
  - `AutomationExecution` has status `queued | running | completed | failed | stopped`, plus `waitState` = delay / reply / retry. It keeps a **graph snapshot**, so later edits never change a run in progress.
  - `AutomationExecutionStep` records each step's status, attempt, output and error.
- **No infinite loops:**
  - Graphs must be acyclic; this is checked on publish and test.
  - At most 100 steps per run.
  - An automation never re-triggers itself (the trigger chain is tracked).
  - Automations can start other automations at most 3 levels deep.
  - One live run per contact per automation.
  - At most 10 runs per contact per minute across the workspace.
- **Safe retries:**
  - Network errors, timeouts, 429 and 5xx responses are retried 3 times (after 1, 5 and 15 minutes). 4xx errors fail immediately.
  - A step that was interrupted mid-flight (message, template, webhook or AI) is **not** repeated, so a message is never sent twice.
  - A failed run can be retried manually from the step that failed; completed steps are not repeated.
  - Each step's "if this step fails" setting decides whether the run stops or continues.
- **Leases:** a worker holds a 60-second lease, so two workers never run the same execution.
- **Running:**
  - Runs start right after the triggering request, using `after()`.
  - Delays, reply timeouts, retries and schedules run from the scheduler: in-process on `next start`, or via the cron route `GET /api/cron/campaigns` with `CRON_SECRET` (the same tick as campaigns).
- **Compliance:**
  - Opted-out and suppressed contacts are never messaged.
  - Free-form messages are only sent inside the 24-hour window.
  - Marketing templates require an opt-in.
  - Every send appears in the Inbox with the automation's name.

## API (under `/api/organizations/{orgId}/automations`)

| Endpoint | Purpose |
| --- | --- |
| `GET`, `POST` | List, create (`start: blank \| demo_welcome`). |
| `/{id}` `GET`, `PATCH`, `DELETE` | Get, save the draft, delete. |
| `/{id}/publish` | Publish a new version. |
| `/{id}/status` | Activate / deactivate. |
| `/{id}/duplicate` | Duplicate. |
| `/{id}/test` | Test run. |
| `/{id}/executions` | List runs. |
| `/{id}/analytics` | Analytics. |
| `/{id}/versions/{vid}` | Restore a version to the draft. |
| `/{id}/webhook-secret` | Create the inbound-webhook secret. |
| `/executions/{eid}` `GET`, `POST` | Run details; `stop` / `retry`. |

Public endpoint: `POST /api/automations/hooks/{id}`.

**Permissions:** `automations:read` (all roles) and `automations:manage` (owner, manager).

## Demo workflow

The demo workflow is: New Contact → Welcome Message → Delay (2 min) → Ask Requirement (buttons: Website / Marketing / Just browsing; waits for the reply) → Condition (reply contains website / marketing / price / quote / buy) → **Yes:** Assign Sales (least-busy agent) → tag "Sales lead" → End. **No:** tag "Browsing" → End.

It is available as **"Welcome & route to sales"** in *Create automation*. The seed also adds it to Demo Organization A as a draft.

## New env var (name only)

`ANTHROPIC_API_KEY` is optional and only needed for the AI response step.

## Known limitations

- The realtime broker is in-process (see Phase 4). Multi-instance deployments need Redis or similar.
- On Vercel, delays, reply timeouts and retries only fire when the cron route is called. Per-minute cron needs a paid Vercel plan.
- The AI step has not been run against the live Claude API in this environment because no key is configured. It is tested only for the "not configured" path.
- Flow submissions are supported as a trigger. Building WhatsApp Flows themselves is not part of this phase.
- DNS rebinding between the SSRF check and the request is not fully prevented.
