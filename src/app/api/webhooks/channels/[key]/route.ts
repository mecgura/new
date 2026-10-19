import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { clientIp, ApiError } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { inboundEmailSchema } from "@/lib/validations";
import { receiveChannelMessage } from "@/services/channels/inbound";

export const dynamic = "force-dynamic";
const MAX_BYTES = 200_000;

/**
 * Inbound customer email for one inbox (public URL; the random key in the path is the secret).
 * Providers differ, so the body is a small normalised JSON that a mail forwarder or inbound-parse
 * rule posts: { from, fromName?, subject?, text, messageId? }.
 */
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  try {
    enforceRateLimit(`ch-in:${clientIp(req)}`, 120, 60_000);
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    throw e;
  }
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const account = /^[a-f0-9]{48}$/.test(key) ? await db.channelAccount.findUnique({ where: { publicKey: key } }) : null;
  if (!account || account.kind !== "email" || account.status === "disabled") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = inboundEmailSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid email payload", details: parsed.error.flatten().fieldErrors }, { status: 400 });
  const m = parsed.data;
  const r = await receiveChannelMessage(account, {
    identityKind: "email",
    identityValue: m.from,
    name: m.fromName,
    subject: m.subject,
    body: m.text,
    externalId: m.messageId ?? `in.${randomUUID()}`,
    at: new Date(),
  });
  return NextResponse.json({ received: r ? 1 : 0, duplicate: r ? 0 : 1 });
}
