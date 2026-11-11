import { NextResponse } from "next/server";
import { handleSubscriptionWebhook } from "@/lib/services/sub-webhooks";

export const dynamic = "force-dynamic";
/** Payment-provider webhook for clinic subscription payments. Unauthenticated by design: trust comes from the provider's signature, checked on the raw body. */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const r = await handleSubscriptionWebhook(provider, await req.text(), req.headers);
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}
