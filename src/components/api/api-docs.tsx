"use client";

import * as React from "react";
import { Alert, Badge, Card, CardBody, CardHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { API_KEY_LIMITS, API_SCOPES, type ApiScope } from "@/lib/api-keys";
import { VERIFY_NODE } from "@/lib/webhook-docs";
import { CodeBlock } from "@/components/api/code-block";

const ENDPOINTS: { method: string; path: string; scope: ApiScope | null; what: string }[] = [
  { method: "GET", path: "/api/v1/me", scope: null, what: "Which workspace and permissions this key has" },
  { method: "GET", path: "/api/v1/numbers", scope: "numbers:read", what: "Your connected WhatsApp numbers (ids for number_id)" },
  { method: "GET", path: "/api/v1/templates", scope: "templates:read", what: "Approved templates, their variables and the numbers they can be sent from" },
  { method: "GET", path: "/api/v1/contacts", scope: "contacts:read", what: "List contacts. Query: q, phone, page, pageSize (max 100)" },
  { method: "POST", path: "/api/v1/contacts", scope: "contacts:write", what: "Create a contact (409 if the phone exists)" },
  { method: "GET", path: "/api/v1/contacts/{id}", scope: "contacts:read", what: "One contact" },
  { method: "PATCH", path: "/api/v1/contacts/{id}", scope: "contacts:write", what: "Update name, email, lead_status, lifecycle, tags, custom_fields" },
  { method: "GET", path: "/api/v1/conversations", scope: "conversations:read", what: "List conversations. Query: number_id, page, pageSize" },
  { method: "GET", path: "/api/v1/conversations/{id}/messages", scope: "messages:read", what: "Messages of a conversation, newest first" },
  { method: "POST", path: "/api/v1/messages", scope: "messages:send", what: "Send a text or an approved template" },
];

export function ApiDocs() {
  const [origin, setOrigin] = React.useState("https://your-mecgura-domain");
  React.useEffect(() => {
    const t = window.setTimeout(() => setOrigin(window.location.origin), 0);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Getting started" description={`Base URL: ${origin}`} />
        <CardBody className="space-y-4">
          <p className="text-body text-app-muted">
            Send your key in the <code className="font-mono text-app-text">Authorization</code> header. Keys belong to one workspace, so every call only ever sees that workspace&apos;s numbers, contacts and conversations. Call the API from your server — never from a browser or app, where the key could be copied.
          </p>
          <CodeBlock label="Check your key" code={`curl ${origin}/api/v1/me \\\n  -H "Authorization: Bearer mgk_YOUR_KEY"`} />
          <Alert tone="info" title="Rules that always apply">
            Keys are accepted only in the header (never the URL). Messages follow the same rules as the inbox: customers who opted out or are suppressed are never messaged, free-form text needs an open 24-hour window, only approved templates can start a conversation, and marketing templates need recorded opt-in.
          </Alert>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Endpoints" description="Responses are JSON. Lists look like { data, page, page_size, total, has_more }." />
        <Table caption="API endpoints" className="min-w-[720px]">
          <THead>
            <tr>
              <TH>Endpoint</TH>
              <TH>Permission</TH>
              <TH>What it does</TH>
            </tr>
          </THead>
          <TBody>
            {ENDPOINTS.map((e) => (
              <TR key={e.method + e.path}>
                <TD className="whitespace-nowrap font-mono text-small">
                  <Badge tone={e.method === "GET" ? "info" : "primary"}>{e.method}</Badge> {e.path}
                </TD>
                <TD className="font-mono text-small">{e.scope ?? <span className="font-sans text-app-subtle">any key</span>}</TD>
                <TD className="text-small text-app-muted">{e.what}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Send a message" description="With several numbers you must choose one with number_id — MECGURA never guesses." />
        <CardBody className="grid gap-4 xl:grid-cols-2">
          <CodeBlock
            label="Text (customer wrote within the last 24 hours)"
            code={`curl -X POST ${origin}/api/v1/messages \\
  -H "Authorization: Bearer mgk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "number_id": "NUMBER_ID",
    "to": "+919876543210",
    "type": "text",
    "text": "Your order has shipped 🚚"
  }'`}
          />
          <CodeBlock
            label="Approved template (starts or restarts a conversation)"
            code={`curl -X POST ${origin}/api/v1/messages \\
  -H "Authorization: Bearer mgk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "number_id": "NUMBER_ID",
    "to": "+919876543210",
    "type": "template",
    "template": {
      "name": "order_update",
      "language": "en",
      "values": { "body.1": "Asha" }
    }
  }'`}
          />
          <CodeBlock
            label="Create a contact with recorded consent"
            code={`curl -X POST ${origin}/api/v1/contacts \\
  -H "Authorization: Bearer mgk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "phone": "+919876543210",
    "name": "Asha",
    "tags": ["website"],
    "opt_in": { "evidence": "Website form, 6 Oct 2026" }
  }'`}
          />
          <CodeBlock
            label="Response (201)"
            code={`{
  "data": {
    "id": "…", "conversation_id": "…", "number_id": "…",
    "to": "+919876543210", "type": "text",
    "status": "sent", "error": null, "created_at": "…"
  }
}`}
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Permissions" description="Each endpoint needs exactly the permission shown above." />
          <ul className="divide-y divide-app-border">
            {(Object.keys(API_SCOPES) as ApiScope[]).map((s) => (
              <li key={s} className="flex items-baseline justify-between gap-3 px-5 py-2.5">
                <code className="font-mono text-small text-app-text">{s}</code>
                <span className="text-small text-app-muted">{API_SCOPES[s]}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Limits and errors" />
          <CardBody className="space-y-3 text-small text-app-muted">
            <p>
              <strong className="text-app-text">{API_KEY_LIMITS.perMinute} requests per minute per key.</strong> Every response carries <code className="font-mono">X-RateLimit-Limit</code>, <code className="font-mono">-Remaining</code> and <code className="font-mono">-Reset</code>; over the limit you get <code className="font-mono">429</code> with <code className="font-mono">Retry-After</code>. Repeated bad keys from one address are blocked for a minute.
            </p>
            <p>Errors look like <code className="font-mono text-app-text">{`{ "error": "…", "code": "VALIDATION_ERROR", "details": { "to": ["…"] } }`}</code>.</p>
            <ul className="list-inside list-disc space-y-0.5">
              <li><code className="font-mono">400</code> invalid input · <code className="font-mono">401</code> missing/invalid/revoked/expired key</li>
              <li><code className="font-mono">403</code> key lacks the permission · <code className="font-mono">404</code> not found in your workspace</li>
              <li><code className="font-mono">409</code> blocked by a rule (opt-out, closed window, plan limit) · <code className="font-mono">429</code> rate limited</li>
            </ul>
            <p>Every response has an <code className="font-mono">X-Request-Id</code> you can find in the Logs tab. Logs keep only method, path, status, timing and a shortened network address, for {API_KEY_LIMITS.logRetentionDays} days.</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Webhooks" description="Get events pushed to your server instead of polling — set them up on the Webhooks page." />
        <CardBody className="space-y-3">
          <p className="text-small text-app-muted">
            Every delivery is a POST with <code className="font-mono">X-Mecgura-Signature: t=&lt;unix&gt;,v1=&lt;hmac&gt;</code>. Always verify it:
          </p>
          <CodeBlock code={VERIFY_NODE} />
        </CardBody>
      </Card>
    </div>
  );
}
