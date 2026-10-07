import { randomBytes } from "node:crypto";
import { assertMonthlyQuota, hasFeature } from "@/services/billing/entitlements";
import { db } from "@/lib/db";
import { ApiError, clientIp, toErrorResponse } from "@/lib/api";
import { API_KEY_LIMITS, hashApiKey, looksLikeApiKey, maskIp, type ApiScope } from "@/lib/api-keys";
import { rateLimit, rateLimited } from "@/lib/rate-limit";
import { incrementUsage } from "@/lib/services/usage";

export type ApiPrincipal = { organizationId: string; keyId: string; keyName: string; scopes: ApiScope[]; createdById: string | null; rate: { limit: number; remaining: number; resetAtSec: number } };

const FAIL_LIMIT = 20; // bad credentials per IP per minute before that IP is refused outright
const LAST_USED_EVERY_MS = 60_000;

function scopesOf(raw: string): ApiScope[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as ApiScope[]) : [];
  } catch {
    return [];
  }
}

/**
 * Public API wrapper. In order: refuse IPs that keep sending bad keys → read the Bearer key (never a query
 * parameter) → look up its hash → key must be live and its workspace active → key must hold the endpoint's
 * scope → per-key rate limit → run the handler with the key's workspace → write a metadata-only log line.
 * Tenant id comes ONLY from the key — handlers must never read an organisation id from the request.
 */
export function apiHandle<Ctx>(scope: ApiScope | null, fn: (req: Request, ctx: Ctx, p: ApiPrincipal) => Promise<Response>) {
  return async (req: Request, ctx?: Ctx): Promise<Response> => {
    const started = Date.now();
    const ip = clientIp(req);
    const requestId = `req_${randomBytes(8).toString("hex")}`;
    const path = new URL(req.url).pathname.slice(0, 200);
    let keyRow: Awaited<ReturnType<typeof findKey>> = null;
    let res: Response;
    let errorCode = "";
    let rate: ApiPrincipal["rate"] | null = null;
    try {
      if (rateLimited(`api-fail:${ip}`, FAIL_LIMIT)) throw new ApiError("RATE_LIMITED", "Too many failed authentication attempts. Try again in a minute.", { headers: { "Retry-After": "60" } });
      const header = req.headers.get("authorization") ?? "";
      const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? "";
      if (!looksLikeApiKey(token)) {
        rateLimit(`api-fail:${ip}`, FAIL_LIMIT, 60_000);
        throw new ApiError("UNAUTHENTICATED", "Missing or invalid API key. Send it as “Authorization: Bearer <key>”.");
      }
      keyRow = await findKey(hashApiKey(token));
      if (!keyRow) {
        rateLimit(`api-fail:${ip}`, FAIL_LIMIT, 60_000);
        throw new ApiError("UNAUTHENTICATED", "Invalid API key.");
      }
      if (keyRow.revokedAt) throw new ApiError("UNAUTHENTICATED", "This API key was revoked.");
      if (keyRow.expiresAt && keyRow.expiresAt <= new Date()) throw new ApiError("UNAUTHENTICATED", "This API key has expired.");
      if (keyRow.organization.status !== "active") throw new ApiError("FORBIDDEN", "This workspace is suspended.");
      if (!(await hasFeature(keyRow.organizationId, "api"))) throw new ApiError("FORBIDDEN", "API access isn't included in this workspace's plan.");
      try {
        await assertMonthlyQuota(keyRow.organizationId, "apiRequests", 1, "API requests");
      } catch (e) {
        throw new ApiError("RATE_LIMITED", e instanceof ApiError ? e.message : "Monthly API allowance used up.");
      }
      const scopes = scopesOf(keyRow.permissions);
      if (scope && !scopes.includes(scope)) throw new ApiError("FORBIDDEN", `This API key doesn't have the “${scope}” permission.`);
      const r = rateLimit(`api-key:${keyRow.id}`, API_KEY_LIMITS.perMinute, 60_000);
      rate = { limit: r.limit, remaining: r.remaining, resetAtSec: r.resetAtSec };
      if (!r.allowed) throw new ApiError("RATE_LIMITED", `Rate limit exceeded (${API_KEY_LIMITS.perMinute} requests per minute per key).`, { headers: { "Retry-After": String(r.retryAfterSec) } });
      const principal: ApiPrincipal = { organizationId: keyRow.organizationId, keyId: keyRow.id, keyName: keyRow.name, scopes, createdById: keyRow.createdById, rate };
      res = await fn(req, ctx as Ctx, principal);
    } catch (e) {
      res = toErrorResponse(e);
      errorCode = e instanceof ApiError ? e.code : "SERVER_ERROR";
    }
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Request-Id", requestId);
    if (rate) {
      headers.set("X-RateLimit-Limit", String(rate.limit));
      headers.set("X-RateLimit-Remaining", String(rate.remaining));
      headers.set("X-RateLimit-Reset", String(rate.resetAtSec));
    }
    const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    if (keyRow) await record(keyRow, { requestId, method: req.method, path, status: out.status, durationMs: Date.now() - started, ip, userAgent: req.headers.get("user-agent") ?? "", errorCode });
    return out;
  };
}

function findKey(hash: string) {
  return db.apiKey.findUnique({ where: { keyHash: hash }, include: { organization: { select: { status: true } } } });
}

/** Metadata only: never the body, query string, Authorization header or any secret. */
async function record(
  key: NonNullable<Awaited<ReturnType<typeof findKey>>>,
  m: { requestId: string; method: string; path: string; status: number; durationMs: number; ip: string; userAgent: string; errorCode: string }
) {
  try {
    await db.apiRequestLog.create({
      data: { id: m.requestId, organizationId: key.organizationId, apiKeyId: key.id, method: m.method, path: m.path, status: m.status, durationMs: m.durationMs, ip: maskIp(m.ip), userAgent: m.userAgent.slice(0, 120), errorCode: m.errorCode },
    });
    await incrementUsage(key.organizationId, "api_calls");
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_EVERY_MS || key.lastUsedIp !== maskIp(m.ip)) {
      await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date(), lastUsedIp: maskIp(m.ip) } });
    }
  } catch (e) {
    console.error("[api] could not write request log:", e);
  }
}
