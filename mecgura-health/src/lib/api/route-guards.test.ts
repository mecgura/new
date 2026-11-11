import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guard: every HTTP route file must use a recognised authentication/verification primitive, or be on the short, reviewed list of
 * routes that are public on purpose. A new route that does neither fails this test, so "forgot to protect it" cannot ship silently.
 */
const ROOT = path.join(process.cwd(), "src/app");
const GUARDS = [/\b(apiRoute|keyRoute|patientRoute)\s*[<(]/, /\b(requireTenantApiContext|requireApiContext|requireContext|getContext)\(/];
/** Super Admin-only filters: the service ignores the value for every other caller (listLegalHolds pins them to their own clinic). */
const TENANT_FILTER_OK = new Set(["api/privacy/holds/route.ts"]);
const PUBLIC: Record<string, string> = {
  "health/route.ts": "liveness probe, returns {status:ok}",
  "ready/route.ts": "readiness probe: check names + statuses only, rate-limited",
  "version/route.ts": "build identity only",
  "api/auth/[...nextauth]/route.ts": "Auth.js handlers",
  "api/internal/communications/run/route.ts": "scheduler: CRON_SECRET bearer, off when unset",
  "api/webhooks/[channel]/route.ts": "provider webhooks: signature verified on the raw body",
  "api/webhooks/subscriptions/[provider]/route.ts": "payment webhooks: signature verified on the raw body",
  "site/robots.txt/route.ts": "public clinic robots.txt",
  "site/sitemap.xml/route.ts": "public clinic sitemap",
};
function routes(dir: string, out: string[] = []) { for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isDirectory()) routes(p, out); else if (f === "route.ts") out.push(p); } return out; }

describe("route guards", () => {
  const files = routes(ROOT).map((p) => ({ rel: path.relative(ROOT, p).replace(/\\/g, "/").replace(/\([^)]*\)\//g, ""), src: readFileSync(p, "utf8") }));
  it("finds the routes", () => expect(files.length).toBeGreaterThan(300));
  it("every route uses a guard or is on the reviewed public list", () => {
    const unguarded = files.filter((f) => !GUARDS.some((g) => g.test(f.src)) && !(f.rel in PUBLIC)).map((f) => f.rel);
    expect(unguarded).toEqual([]);
  });
  it("the public list contains only routes that exist, and none of them reads a tenantId from the request", () => {
    for (const rel of Object.keys(PUBLIC)) expect(files.some((f) => f.rel === rel), rel).toBe(true);
    for (const f of files.filter((x) => x.rel in PUBLIC)) expect(/searchParams\.get\(["']tenantId["']\)|body\.tenantId/.test(f.src), f.rel).toBe(false);
  });
  it("no route takes the clinic from the request", () => {
    const bad = files.filter((f) => /(searchParams\.get\(["'](tenantId|tenant_id)["']\)|body\.tenantId|json\.tenantId)/.test(f.src)).map((f) => f.rel).filter((r) => !TENANT_FILTER_OK.has(r));
    expect(bad).toEqual([]);
  });
});
