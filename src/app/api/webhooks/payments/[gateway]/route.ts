import { NextResponse } from "next/server";
import { getGateway } from "@/providers/payments/registry";
import { GatewayError } from "@/providers/payments/types";
import { applyGatewayEvents } from "@/services/billing/billing";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ gateway: string }> };

/**
 * Payment provider callbacks. The provider's signature over the RAW body is verified first; unsigned or
 * mis-signed requests are rejected and change nothing. Each event is applied once (idempotent).
 */
export async function POST(req: Request, { params }: Ctx) {
  const gateway = getGateway((await params).gateway);
  if (!gateway) return NextResponse.json({ error: "Unknown gateway" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 200_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  try {
    const events = await gateway.parseWebhook(raw, req.headers);
    const results = await applyGatewayEvents(gateway.id, events);
    return NextResponse.json({ received: events.length, results });
  } catch (e) {
    if (e instanceof GatewayError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[billing] payment webhook failed:", e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
