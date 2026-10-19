import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, ApiError } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { VISITOR_ID, visitorKnown, visitorMessages, visitorSend, webchatAccount, widgetConfig } from "@/services/channels/webchat";

export const dynamic = "force-dynamic";

// The widget runs on the customer's own website, so these endpoints are cross-origin by design.
// No cookies are used; a visitor can only read the thread whose random id they hold.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS });
type Ctx = { params: Promise<{ key: string }> };

const sendSchema = z
  .object({ visitorId: z.string().regex(VISITOR_ID), name: z.string().trim().max(80).default(""), text: z.string().trim().min(1).max(2000) })
  .strict();

function limited(req: Request, bucket: string, limit: number) {
  try {
    enforceRateLimit(`webchat:${bucket}:${clientIp(req)}`, limit, 60_000);
    return false;
  } catch (e) {
    if (e instanceof ApiError) return true;
    throw e;
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Widget settings, plus the team's replies for a visitor when `visitorId` is given (`since` = ISO time of the last reply seen). */
export async function GET(req: Request, { params }: Ctx) {
  if (limited(req, "get", 120)) return reply({ error: "Too many requests" }, 429);
  const account = await webchatAccount((await params).key);
  if (!account) return reply({ error: "Not found" }, 404);
  const q = new URL(req.url).searchParams;
  const visitorId = q.get("visitorId");
  if (!visitorId) return reply({ config: widgetConfig(account) });
  if (!VISITOR_ID.test(visitorId)) return reply({ error: "Invalid visitor" }, 400);
  const sinceRaw = q.get("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw) : null;
  return reply({ messages: await visitorMessages(account, visitorId, since) });
}

export async function POST(req: Request, { params }: Ctx) {
  if (limited(req, "post", 20)) return reply({ error: "Too many requests" }, 429);
  const account = await webchatAccount((await params).key);
  if (!account) return reply({ error: "Not found" }, 404);
  if (Number(req.headers.get("content-length") ?? "0") > 10_000) return reply({ error: "Payload too large" }, 413);
  let json: unknown;
  try {
    json = JSON.parse(await req.text());
  } catch {
    return reply({ error: "Body must be JSON" }, 400);
  }
  const parsed = sendSchema.safeParse(json);
  if (!parsed.success) return reply({ error: "Invalid message" }, 400);
  const { visitorId, name, text } = parsed.data;
  // New visitors are the expensive part (each creates a contact): cap them per IP.
  if (!(await visitorKnown(account, visitorId))) {
    try {
      enforceRateLimit(`webchat:new:${clientIp(req)}`, 10, 60 * 60_000);
    } catch (e) {
      if (e instanceof ApiError) return reply({ error: "Too many requests" }, 429);
      throw e;
    }
  }
  await visitorSend(account, visitorId, name, text);
  return reply({ ok: true }, 201);
}
