import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GET as health } from "@/app/health/route";
import { GET as version } from "@/app/version/route";
import { GET as ready } from "@/app/ready/route";
import { recordJob, pruneOps } from "./jobs";
import { recordServerError } from "./errors";
import { readiness } from "./readiness";
import { seedSystemData, uniq } from "@/test/helpers";

describe("Phase 17 operations", () => {
  beforeAll(async () => { await seedSystemData(); });

  it("health is liveness only and exposes nothing", async () => {
    const r = await health(); expect(r.status).toBe(200); expect(await r.json()).toEqual({ status: "ok" });
  });
  it("version reports name/version and no secrets", async () => {
    process.env.AUTH_SECRET = "very-secret-auth-value-0123456789abcdef"; const body = JSON.stringify(await (await version()).json());
    expect(body).toContain("mecgura-health"); expect(body).not.toContain("very-secret-auth-value");
  });
  it("readiness checks the database and migrations, labels unconfigured integrations honestly", async () => {
    const r = await readiness(); const by = Object.fromEntries(r.checks.map((c) => [c.name, c]));
    expect(by.database.status).toBe("ok"); expect(r.status).not.toBe("not_ready");
    expect(["not_configured", "ok"]).toContain(by.payment_provider.status);
    expect(JSON.stringify(r)).not.toContain("very-secret-auth-value");
    const res = await ready(); expect([200]).toContain(res.status);
  });
  it("recordJob stores success, partial and failed runs; a failure raises a security event and never throws", async () => {
    const n = uniq("job");
    expect((await recordJob(n, async () => ({ sent: 3, errors: 0 }))).ok).toBe(true);
    expect((await recordJob(n, async () => ({ sent: 1, errors: 2 }))).ok).toBe(true);
    const bad = await recordJob(n, async () => { throw new Error("boom"); }); expect(bad.ok).toBe(false);
    const runs = await db.jobRun.findMany({ where: { name: n }, orderBy: { startedAt: "asc" } });
    expect(runs.map((x) => x.status).sort()).toEqual(["FAILED", "OK", "PARTIAL"]);
    expect(runs.find((x) => x.status === "FAILED")?.error).toBe("boom");
    expect(runs.every((x) => x.finishedAt && x.durationMs !== null)).toBe(true);
    expect(await db.securityEvent.count({ where: { type: "JOB_FAILED", summary: { contains: n } } })).toBeGreaterThan(0);
  });
  it("error store sanitises long tokens, throttles repeats and prunes by age", async () => {
    const route = `/api/${uniq("x")}`;
    await recordServerError({ route, method: "GET", status: 500, code: "INTERNAL", requestId: "r1", message: "failed for abcdefghijklmnopqrstuvwxyz0123456789 token" });
    await recordServerError({ route, method: "GET", status: 500, code: "INTERNAL", requestId: "r2", message: "again" });
    const rows = await db.errorEvent.findMany({ where: { route } }); expect(rows).toHaveLength(1);
    expect(rows[0].message).not.toContain("abcdefghijklmnopqrstuvwxyz"); expect(rows[0].tenantId).toBeNull();
    await db.errorEvent.update({ where: { id: rows[0].id }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    const p = await pruneOps(); expect(p.errors).toBeGreaterThanOrEqual(1); expect(await db.errorEvent.count({ where: { route } })).toBe(0);
  });
});
