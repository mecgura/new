import { NextResponse } from "next/server";
import { handleWebhook, metaHandshake } from "@/lib/communications/webhooks";
export const dynamic = "force-dynamic";

/** The URL the provider signed. Behind a proxy the request URL can differ, so the configured public APP_URL wins. */
function publicUrl(req: Request, channel: string) { const base = process.env.APP_URL?.replace(/\/$/, ""); return base ? `${base}/api/webhooks/${channel}` : new URL(req.url).toString().split("?")[0]; }
const ipOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

export async function POST(req: Request, ctx: { params: Promise<{ channel: string }> }) {
  const { channel } = await ctx.params;
  const rawBody = await req.text();
  const r = await handleWebhook(channel, { method: "POST", url: publicUrl(req, channel), headers: req.headers, rawBody, query: new URL(req.url).searchParams }, ipOf(req));
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
export async function GET(req: Request, ctx: { params: Promise<{ channel: string }> }) {
  const { channel } = await ctx.params;
  if (channel !== "whatsapp") return NextResponse.json({ ok: false }, { status: 404 });
  const r = metaHandshake(new URL(req.url).searchParams);
  return new NextResponse(r.body, { status: r.status, headers: { "Cache-Control": "no-store", "content-type": "text/plain" } });
}
