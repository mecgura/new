import { headers } from "next/headers";

/** Best-effort client IP + UA for audit/rate limiting. Never trust for authorization. */
export async function getRequestMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 255) ?? null };
}
