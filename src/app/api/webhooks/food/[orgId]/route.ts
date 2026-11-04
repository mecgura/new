import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api";
import { handlePaymentWebhook } from "@/services/food/food";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ orgId: string }> };

/** The client's own Razorpay account calls this when a food order's payment link is paid (signature checked first). */
export async function POST(req: Request, { params }: Ctx) {
  const raw = await req.text();
  if (raw.length > 100_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  try {
    return NextResponse.json({ result: await handlePaymentWebhook((await params).orgId.slice(0, 40), raw, req.headers) });
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[food] webhook failed:", e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
