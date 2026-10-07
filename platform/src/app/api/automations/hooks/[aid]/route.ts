import { NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { automationHookSchema, idSchema } from "@/lib/validations";
import { triggerFromWebhook } from "@/services/automations/automations";

export const dynamic = "force-dynamic";

/**
 * Inbound webhook trigger (server-to-server, so no same-origin check).
 * Auth: "Authorization: Bearer <secret>" — the secret is shown once in the builder.
 */
export async function POST(req: Request, { params }: { params: Promise<{ aid: string }> }) {
  try {
    const id = idSchema.safeParse((await params).aid);
    if (!id.success) throw new ApiError("UNAUTHENTICATED", "Invalid webhook credentials.");
    const aid = id.data;
    enforceRateLimit(`auto-hook:${aid}`, 120, 60_000);
    const auth = req.headers.get("authorization") ?? "";
    const secret = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!secret) throw new ApiError("UNAUTHENTICATED", "Invalid webhook credentials.");
    if (Number(req.headers.get("content-length") ?? 0) > 64 * 1024) throw new ApiError("VALIDATION_ERROR", "Payload too large.");
    const body: unknown = await req.json().catch(() => {
      throw new ApiError("VALIDATION_ERROR", "Body must be JSON.");
    });
    const parsed = automationHookSchema.safeParse(body);
    if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Send { phone, name?, email?, data? }.");
    const r = await triggerFromWebhook(aid, secret, parsed.data);
    return NextResponse.json(r, { status: r.accepted ? 202 : 200 });
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e);
    console.error("[automation hook]", e);
    return errorResponse(new ApiError("SERVER_ERROR"));
  }
}
