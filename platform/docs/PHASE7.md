# Phase 7 — WhatsApp Flows and the AI agent

## WhatsApp Flows (`/flows`)

| Route | Contents |
| --- | --- |
| `/flows` | Template gallery with Appointment Booking, Lead Registration, Product Enquiry, Feedback, Order Enquiry, and a blank flow. Flow list with status tabs (draft / published / retired), search, and submission counts. |
| `/flows/:id` | Builder plus the Submissions, Test and Flow JSON tabs. Agents get a read-only view. |

**Builder chain** (left outline): **Start** (message + button) → **Screens** (inputs: text, email, phone, number, long text, date; selections: dropdown, single choice, multiple choice, opt-in) → **Confirmation** (review screen, optional) → **Submit** (button + thank-you message) → **CRM action**. A live phone preview and validation sit beside the editor.

**CRM action** — on every submission:
- Saves a `FlowSubmission` row holding the contact, answers, timestamp (`createdAt`), flow, source (`whatsapp` / `demo`), flow token and the CRM result.
- Creates the contact, or updates it if it already exists. Answers are mapped to name, email or custom fields.
- Sets lifecycle and lead status, and adds tags.
- Records consent when the opt-in field was ticked (source `flow`).
- Creates an appointment request from the service, date and time fields.
- Adds a contact note with all the answers.
- Optionally auto-assigns the chat to the least busy teammate.
- Sends the thank-you message. This respects consent and the 24h window.

Each step runs independently, and failures are listed in `crmResult.errors`.

**Publishing**
- Live WABA:
  1. `POST /{waba}/flows`, sending the generated Flow JSON (version 6.3). After that, `POST /{flow}/assets` updates it.
  2. Meta's `validation_errors` are shown in the builder. If there are none, the flow is published with `POST /{flow}/publish`.
  3. Retire uses `/deprecate`. Deleting a draft also deletes it on Meta.
- Demo WABA: the flow is published locally and clearly marked "demo — not on Meta". The Test tab submits answers through the **same inbound path** a real `nfm_reply` uses.

**Sending**
- From the inbox composer, use the **Send WhatsApp Flow** button. It lists published flows on the conversation's WABA.
- The message is an interactive `flow` message with flow token `mf.<flowId>.<random>`.
- Inbound `nfm_reply` messages are matched to the flow by that token, or by name if there is no token.
- The submissions table can be exported as CSV (formula-safe; needs `contacts:export`).

## AI agent (`/ai`)

The page has six tabs:
- **Settings**: name, instructions, and which numbers it answers (none ticked = all).
- **Knowledge**: FAQs, products, services, pricing and documents.
- **Actions & handoff**.
- **Test chat**.
- **Activity**: every reply, handoff, summary, skip and error, labelled Live/Demo, with model and tokens.
- **Appointments**: confirm, complete or cancel.

Agent status is draft, active or paused. Only one active agent can answer a given number.

**Actions** (each can be switched on or off):
- Answer questions.
- Qualify lead: qualified / contacted / lost. It never moves a lead back from proposal or won, and never changes customers.
- Collect information: name, email, city, company, budget, requirement.
- Book appointment: creates a *request*, and managers are notified.
- Transfer to human.
- Summarize conversation.

**When the AI answers an inbound message** — all of these must hold:
- An active agent covers the number.
- The chat is not assigned to a teammate.
- `aiStatus` is not `handoff`, or the after-hours resume time has passed.
- The message is not STOP.
- No automation took the message: the dispatcher now reports whether it resumed or started a run.
- No automation is still running for the contact.

The reply runs after the webhook response, using `after()`. Skips caused by automations are logged as `skipped`.

**Human handoff** is triggered by:
- a keyword,
- the model's `transfer_to_human` tool,
- an AI error, or
- a teammate pausing the AI or replying in the chat.

On handoff:
1. The AI stops: `aiStatus = handoff`, with the reason.
2. The chat is assigned per the agent's setting: least busy teammate, a specific teammate, or the unassigned queue (owners and managers are notified).
3. The assignee is notified, the handoff message is sent, and a summary is left as an internal note.

**AI resumes only as configured**:
- `manual`: the **Resume AI** item in the inbox AI menu. This unassigns the chat back to the AI.
- `on_close`: when the chat is closed.
- `after_hours`: N hours without a teammate reply. Each teammate reply restarts the timer.

**Inbox controls**: an AI status chip on each conversation, with Pause AI / Resume AI / Summarize. Messages are badged "AI agent" or "Demo AI · rule-based".

### Live vs demo — honest by design

| | Live AI | Demo AI |
| --- | --- | --- |
| Needs | `ANTHROPIC_API_KEY` | nothing |
| Engine | Claude (`claude-opus-5-5`, official SDK, low effort, server-side fallback). Tools with `strict: true`, at most 4 tool rounds per message. The prompt plus knowledge base is cached. | Keyword rules: FAQ match, product/service lookup, price words, handoff keywords, booking intent with date/time regex, email/name/city extraction |
| Answers on | all numbers it covers | **demo numbers and the test chat only** — live customers never get rule-based replies |
| Labelled | "AI agent" | "Demo AI — rule-based, not production AI" (banner, test chat, inbox badge, message payload, activity log) |
| Usage | counts `ai_replies` | not counted |
| Summary | Claude summary | extractive, prefixed "[Demo summary — rule-based, not AI]" |

If live AI is not configured, messages on a live number are logged as `skipped` with the reason, and no reply is sent.

**Documents**:
- Accepted: plain text only — .txt, .md, .csv (≤200 KB), or pasted text.
- Only the text is stored. PDFs and Word files are refused with a "paste the text instead" message, not silently ignored.
- Up to 60k characters across all documents go into the prompt.

## Permissions

| Permission | Owner | Manager | Agent |
| --- | --- | --- | --- |
| `flows:read` | ✓ | ✓ | ✓ |
| `flows:manage` | ✓ | ✓ | |
| `ai:read` | ✓ | ✓ | ✓ |
| `ai:manage` (incl. test chat) | ✓ | ✓ | |
| `appointments:manage` | ✓ | ✓ | ✓ |

Every query is scoped to the organisation. Cross-tenant ids return 404 (tested).

## API

```
GET/POST   /api/organizations/:org/flows
GET/PATCH/DELETE /api/organizations/:org/flows/:id
POST       /api/organizations/:org/flows/:id/{publish,deprecate,duplicate,demo-submit}
GET        /api/organizations/:org/flows/:id/{submissions,submissions/export,json}
GET/POST   /api/organizations/:org/ai/agents
GET/PATCH/DELETE /api/organizations/:org/ai/agents/:id
POST       /api/organizations/:org/ai/agents/:id/{status,test,documents}
DELETE     /api/organizations/:org/ai/agents/:id/documents/:docId
GET        /api/organizations/:org/ai/agents/:id/interactions
GET        /api/organizations/:org/ai/appointments ; PATCH …/appointments/:id
GET/POST   /api/organizations/:org/inbox/conversations/:cid/ai   (state; pause | resume | summarize)
POST       /api/organizations/:org/inbox/conversations/:cid/messages  { type: "flow", flowId }
```

## Data

New models:
- `Flow`
- `FlowSubmission`
- `AiAgent`
- `AiDocument`
- `AiInteraction`
- `Appointment`

`Conversation` gains `aiStatus`, `aiHandoffAt`, `aiHandoffReason` and `aiResumeAt`.

Migration: `20261006155256_phase7_flows_ai`. `schema.postgres.prisma` is kept identical.

## Tests

- `tests/unit/flows-ai.test.ts`:
  - the 5 templates are valid;
  - Flow JSON (navigate / carry / complete, option ids);
  - answer normalisation;
  - each demo AI rule;
  - prompt contents.
- `tests/integration/flows-ai.test.ts`:
  - flows CRUD, permissions, tenant isolation;
  - demo publish;
  - submission → contact / tags / appointment / note / thank-you;
  - sending a flow from the inbox;
  - AI permissions and isolation;
  - demo mode;
  - documents (PDF refused);
  - draft agent stays silent;
  - demo answers / collect / book / qualify;
  - one active agent per number;
  - keyword handoff → assignment, notification, summary, silence, manual resume;
  - teammate reply → step back; `on_close` resume;
  - live number + no key → no reply;
  - STOP and automations take precedence;
  - **live Claude path with a scripted SDK**: tool loop, CRM updates, cache_control, usage, transfer, refusal.
