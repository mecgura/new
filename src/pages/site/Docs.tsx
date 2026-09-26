import SiteLayout from './SiteLayout'
import { BRAND } from '../../lib/brand'

const base = `https://${BRAND.domain}/api/v1`
const Code = ({ children }: { children: string }) => <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-[#070b0d] p-4 text-[12.5px] leading-relaxed text-soft"><code>{children}</code></pre>

const endpoints: [string, string, string, string?][] = [
  ['GET', '/me', 'Workspace and connected numbers.'],
  ['POST', '/messages', 'Send a message. Types: text, template, image, video, document, buttons, cta_url.', `{
  "to": "919876543210",
  "type": "template",
  "template": "order_update",
  "language": "en",
  "variables": ["Aman", "1024", "shipped"]
}`],
  ['GET', '/messages/:id', 'Get delivery status of a message (queued, sent, delivered, read, failed).'],
  ['GET', '/contacts?page=1&limit=50', 'List contacts.'],
  ['GET', '/contacts/:phone', 'Find a contact by phone number.'],
  ['POST', '/contacts', 'Create or update a contact. New tags can trigger flows and sequences.', `{
  "phone": "919876543210",
  "name": "Aman Sharma",
  "tags": ["website-lead"],
  "attributes": { "city": "Ludhiana", "budget": "50000" }
}`],
  ['GET', '/templates', 'List templates and their approval status.'],
  ['POST', '/flows/:id/trigger', 'Start an automation flow for a phone number.', `{ "to": "919876543210", "name": "Aman", "variables": { "course": "Digital Marketing" } }`],
]

export default function Docs() {
  return (
    <SiteLayout>
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-[.2em] text-brand">Developers</p>
        <h1 className="mt-2 font-display text-4xl font-bold text-white">MECGURA WhatsApp API</h1>
        <p className="mt-3 text-soft">Create an API key in <b>Dashboard → API & Webhooks</b>. Send it as a Bearer token. API access is included from the Growth plan.</p>
        <Code>{`Base URL: ${base}
Authorization: Bearer mk_live_xxxxxxxxxxxxxxxx
Content-Type: application/json`}</Code>

        <h2 className="mt-12 font-display text-2xl font-bold text-white">Endpoints</h2>
        <div className="mt-4 space-y-4">
          {endpoints.map(([m, p, d, body]) => (
            <div key={m + p} className="rounded-2xl border border-line bg-card p-5">
              <div className="flex items-center gap-3"><span className={`rounded-md px-2 py-0.5 text-xs font-bold ${m === 'GET' ? 'bg-sky-400/15 text-sky-300' : 'bg-brand/15 text-brand-2'}`}>{m}</span><code className="text-sm text-white">{p}</code></div>
              <p className="mt-2 text-sm text-muted">{d}</p>
              {body && <Code>{body}</Code>}
            </div>
          ))}
        </div>

        <h2 id="webhooks" className="mt-12 scroll-mt-24 font-display text-2xl font-bold text-white">Webhooks</h2>
        <p className="mt-3 text-soft">Add an HTTPS endpoint in <b>API & Webhooks</b> and choose events. Every request is signed so you can verify it came from MECGURA.</p>
        <Code>{`Events: message.received, message.sent, message.status, contact.created, contact.updated,
conversation.assigned, conversation.resolved, campaign.completed, order.created,
payment.paid, flow.completed

Headers:
  X-Mecgura-Timestamp: 1790000000
  X-Mecgura-Signature: sha256=HMAC_SHA256(secret, timestamp + "." + rawBody)

Body:
{ "event": "message.received", "workspace_id": 12, "created_at": "...", "data": { ... } }`}</Code>
        <Code>{`// Node.js verification
const crypto = require('crypto')
const expected = 'sha256=' + crypto.createHmac('sha256', process.env.MECGURA_WEBHOOK_SECRET)
  .update(req.headers['x-mecgura-timestamp'] + '.' + rawBody).digest('hex')
if (expected !== req.headers['x-mecgura-signature']) return res.status(401).end()`}</Code>
        <p className="mt-3 text-sm text-muted">Failed deliveries are retried with backoff (1m, 5m, 30m, 2h, 12h). Respond with any 2xx status within 10 seconds.</p>

        <h2 className="mt-12 font-display text-2xl font-bold text-white">Errors & limits</h2>
        <p className="mt-3 text-soft">Errors return JSON <code className="text-white">{'{ "error": "...", "code": "..." }'}</code>. Common codes: <code>401</code> invalid key, <code>402</code> plan limit reached or feature not in plan, <code>409</code> 24-hour window closed (send a template), <code>422</code> WhatsApp rejected the message.</p>
        <p className="mt-6 text-sm text-muted">Need help integrating? {BRAND.email} · {BRAND.phone}</p>
      </div>
    </SiteLayout>
  )
}
