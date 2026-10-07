/** Receiver code shown in the docs. Kept as data so the same text is used on /api and /webhooks. */
export const VERIFY_NODE = `import crypto from "node:crypto";

// IMPORTANT: verify against the RAW request body, before any JSON parsing.
export function verify(secret, rawBody, header, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=")));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false; // stale → replay
  const expected = crypto.createHmac("sha256", secret).update(t + "." + rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Express: app.post("/mecgura", express.raw({ type: "application/json" }), (req, res) => {
//   if (!verify(process.env.MECGURA_WEBHOOK_SECRET, req.body.toString("utf8"), req.get("X-Mecgura-Signature"))) return res.sendStatus(400);
//   const event = JSON.parse(req.body);   // { id, type, created_at, organization_id, data }
//   res.sendStatus(200);                  // answer 2xx quickly; do the work afterwards
// });`;

export const VERIFY_PYTHON = `import hmac, hashlib, time

def verify(secret: str, raw_body: bytes, header: str, tolerance=300) -> bool:
    parts = dict(p.strip().split("=", 1) for p in header.split(","))
    t = int(parts.get("t", 0))
    if not t or abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))`;

export const EVENT_SAMPLE = `{
  "id": "evt_6f1c…",
  "type": "message.received",
  "created_at": "2026-10-06T10:15:30.000Z",
  "organization_id": "org_…",
  "data": {
    "message": { "id": "…", "conversation_id": "…", "number_id": "…", "type": "text", "text": "Hi, do you deliver?" },
    "contact": { "id": "…", "name": "Simran", "phone": "+919876543210" }
  }
}`;
