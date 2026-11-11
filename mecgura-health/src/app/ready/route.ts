import { timingSafeEqual } from "node:crypto";
import { readiness } from "@/lib/ops/readiness";
import { rateLimit } from "@/lib/security/rate-limit";
import { getRequestMeta } from "@/lib/security/request";

export const dynamic = "force-dynamic";
const tokenOk = (req?: Request) => {
  const secret = process.env.READINESS_TOKEN || process.env.CRON_SECRET; if (!secret || secret.length < 16) return false;
  const given = Buffer.from((req?.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")); const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
};
/**
 * Readiness: 200 when the instance can serve (database + migrations), 503 otherwise. Optional integrations show as not_configured/warn without failing readiness.
 * The public answer is only the overall status; the per-check detail (providers, migrations, scheduler lag) needs `Authorization: Bearer <READINESS_TOKEN or CRON_SECRET>`.
 */
export async function GET(req?: Request) {
  const { ip } = await getRequestMeta().catch(() => ({ ip: null })); const lim = await rateLimit(`ready:${ip ?? "?"}`, { limit: 120, windowMs: 60_000 }); if (!lim.allowed) return Response.json({ status: "rate_limited" }, { status: 429 });
  const r = await readiness(); const status = r.status === "not_ready" ? 503 : 200;
  return Response.json(tokenOk(req) ? r : { status: r.status }, { status, headers: { "Cache-Control": "no-store" } });
}
