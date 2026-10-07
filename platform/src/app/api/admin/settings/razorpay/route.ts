import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server";
import { getSetting, setSetting } from "@/lib/settings";
import { razorpaySecretConfigured } from "@/lib/razorpay";
import { razorpayConfigSchema } from "@/lib/validations";

function masked(keyId: string): string {
  if (!keyId) return "";
  if (keyId.length <= 8) return "••••";
  return `${keyId.slice(0, 8)}••••${keyId.slice(-4)}`;
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  const keyId = await getSetting("razorpay_key_id");
  const mode = (await getSetting("razorpay_mode", "test")) || "test";
  return NextResponse.json({
    config: { keyId: masked(keyId), hasKeyId: Boolean(keyId), mode, secretConfigured: razorpaySecretConfigured() },
  });
}

export async function PUT(req: Request) {
  const { error } = await requireAdmin();
  if (error) return error;
  const body: unknown = await req.json().catch(() => null);
  const parsed = razorpayConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid Razorpay config.", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  // Empty keyId clears the stored key (disconnects Razorpay).
  if (parsed.data.keyId) await setSetting("razorpay_key_id", parsed.data.keyId);
  else await setSetting("razorpay_key_id", "");
  await setSetting("razorpay_mode", parsed.data.mode);
  return NextResponse.json({ ok: true, mode: parsed.data.mode, hasKeyId: Boolean(parsed.data.keyId) });
}
