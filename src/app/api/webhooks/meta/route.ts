import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clientIp, ApiError } from "@/lib/api";
import { ingestWebhook, MAX_WEBHOOK_BYTES, verifyWebhookSubscription } from "@/services/whatsapp";

export const dynamic = "force-dynamic";

/**
 * Meta webhook endpoint (public). Not wrapped in handle(): Meta sends no Origin
 * and expects plain-text challenge responses. Security comes from the verify
 * token (GET) and the X-Hub-Signature-256 HMAC (POST).
 */
export async function GET(req: Request) {
  try {
    enforceRateLimit(`wh-get:${clientIp(req)}`, 60, 60_000);
  } catch (e) {
    if (e instanceof ApiError) return new NextResponse("Too many requests", { status: 429 });
    throw e;
  }
  const q = new URL(req.url).searchParams;
  const challenge = await verifyWebhookSubscription(q.get("hub.mode"), q.get("hub.verify_token"), q.get("hub.challenge"));
  if (!challenge) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const raw = Buffer.from(await req.arrayBuffer());
  try {
    const result = await ingestWebhook(raw, req.headers.get("x-hub-signature-256"));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    // 200 quickly so Meta doesn't retry; processing already happened idempotently.
    return NextResponse.json({ received: result.received, duplicates: result.duplicates });
  } catch (e) {
    console.error("[webhook:meta] ingestion failed", e);
    // 500 makes Meta retry later; events are deduplicated on retry.
    return NextResponse.json({ error: "Temporary failure" }, { status: 500 });
  }
}
