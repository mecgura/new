import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server";
import { getRazorpay } from "@/lib/razorpay";

/** Read-only test: lists 1 order to verify the keys work. Creates nothing. */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  const razorpay = await getRazorpay();
  if (!razorpay) {
    return NextResponse.json(
      { ok: false, message: "Razorpay is not configured. Save Key ID in settings and set RAZORPAY_KEY_SECRET in .env." },
      { status: 400 }
    );
  }
  try {
    await razorpay.client.orders.all({ count: 1 });
    return NextResponse.json({ ok: true, mode: razorpay.mode, message: `Connected successfully (${razorpay.mode} mode).` });
  } catch (e) {
    console.error("Razorpay status check failed:", e);
    return NextResponse.json(
      { ok: false, message: "Could not connect to Razorpay. Check Key ID, secret and mode." },
      { status: 502 }
    );
  }
}
