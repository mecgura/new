import { readiness } from "@/lib/ops/readiness";
import { rateLimit } from "@/lib/security/rate-limit";
import { getRequestMeta } from "@/lib/security/request";

export const dynamic = "force-dynamic";
/** Readiness: 200 when the instance can serve (database + migrations), 503 otherwise. Optional integrations show as not_configured/warn without failing readiness. */
export async function GET() {
  const { ip } = await getRequestMeta().catch(() => ({ ip: null })); const lim = await rateLimit(`ready:${ip ?? "?"}`, { limit: 120, windowMs: 60_000 }); if (!lim.allowed) return Response.json({ status: "rate_limited" }, { status: 429 });
  const r = await readiness(); return Response.json(r, { status: r.status === "not_ready" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
