import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { VISITOR_ID } from "@/services/channels/webchat";
import { captureLead, siteChatAccount, siteChatConfig, visitorMessageWithBot } from "@/services/site/lead-chat";

export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("lead"), visitorId: z.string().regex(VISITOR_ID), name: z.string().trim().max(80).default(""), phone: z.string().trim().min(5).max(20) }).strict(),
  z.object({ action: z.literal("message"), visitorId: z.string().regex(VISITOR_ID), text: z.string().trim().min(1).max(1000) }).strict(),
]);

function fail(e: unknown) {
  if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status, headers: e.headers });
  console.error("[site-chat] unexpected failure:", e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : e);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

/** Home page chatbot settings (public: it only says whether the chat is on). */
export async function GET() {
  return NextResponse.json(await siteChatConfig());
}

/** A visitor shares their name and number, or sends a chat message. Public, so heavily rate limited. */
export async function POST(req: Request) {
  try {
    enforceRateLimit(`site-chat:${clientIp(req)}`, 20, 60_000);
    const body: unknown = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });
    const account = await siteChatAccount();
    if (!account) return NextResponse.json({ error: "Chat is not available." }, { status: 404 });
    const input = parsed.data;
    if (input.action === "lead") {
      enforceRateLimit(`site-lead:${clientIp(req)}`, 5, 10 * 60_000);
      return NextResponse.json(await captureLead(account, input));
    }
    return NextResponse.json(await visitorMessageWithBot(account, input.visitorId, input.text));
  } catch (e) {
    return fail(e);
  }
}
