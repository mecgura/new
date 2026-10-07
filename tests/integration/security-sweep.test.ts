import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Nothing in this file may reach the network, and background work isn't needed.
vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

import { db } from "@/lib/db";
import { actAs, addMember, makeOrg, makePlan, makeUser, params, req, BASE } from "../helpers";
import { resetRateLimits } from "@/lib/rate-limit";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as demoInbound from "@/app/api/organizations/[orgId]/inbox/demo/inbound/route";

/**
 * Cross-cutting guarantees checked against EVERY API route file, so a route added later can't silently skip
 * them:
 *   1. nothing under /api/organizations, /api/admin, /api/me, /api/notifications works without a session;
 *   2. a member of workspace B can't use workspace A's id, nor touch A's resources through B's own URL;
 *   3. non-admins can't reach /api/admin;
 *   4. whatever garbage an authorised user sends, no route answers 5xx;
 *   5. public / secret-protected surfaces refuse unauthenticated or unsigned callers.
 */

type Handler = (r: Request, c?: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Mod = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Handler>>;
// Vite's glob helper (vitest runs on Vite); typed by hand because the project's tsconfig doesn't load vite/client types.
const files = (import.meta as unknown as { glob: (p: string) => Record<string, () => Promise<Mod>> }).glob("../../src/app/api/**/route.ts");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Route = { path: string; segments: string[]; dynamic: string[]; load: () => Promise<Mod> };
const routes: Route[] = Object.entries(files).map(([file, load]) => {
  const path = file.replace(/^.*src\/app/, "").replace(/\/route\.ts$/, "");
  const segments = path.split("/").filter(Boolean);
  return { path, segments, dynamic: segments.filter((s) => /^\[.+\]$/.test(s)).map((s) => s.slice(1, -1)), load };
});
const group = (prefix: string) => routes.filter((r) => r.path.startsWith(prefix));
const orgRoutes = group("/api/organizations/[orgId]");
const adminRoutes = group("/api/admin");
const sessionRoutes = [...orgRoutes, ...adminRoutes, ...group("/api/me"), ...group("/api/notifications")];
const PUBLIC_ROUTES = routes.filter((r) => !sessionRoutes.includes(r) && !r.path.startsWith("/api/v1"));

const fill = (r: Route, v: Record<string, string>, fallback: string) => "/" + r.segments.map((s) => (/^\[.+\]$/.test(s) ? (v[s.slice(1, -1)] ?? fallback) : s)).join("/");
const call = async (r: Route, m: (typeof METHODS)[number], url: string, ctxParams: Record<string, string>, body?: BodyInit | null) => {
  const mod = await r.load();
  const h = mod[m];
  if (!h) return null;
  const request = new Request(`${BASE}${url}`, { method: m, headers: { host: "localhost:3000", "content-type": "application/json" }, body: m === "GET" ? undefined : (body ?? "{}") });
  try {
    return await h(request, { params: Promise.resolve(ctxParams) });
  } catch (e) {
    return new Response(JSON.stringify({ thrown: String(e) }), { status: 599 });
  }
};
const methodsOf = async (r: Route) => {
  const mod = await r.load();
  return METHODS.filter((m) => typeof mod[m] === "function");
};

type U = Awaited<ReturnType<typeof makeUser>>;
let admin: U;
let loner: U; // a user with no workspace
let A: { orgId: string; owner: U; agent: U };
let B: { orgId: string; owner: U };
let C: { orgId: string; owner: U }; // disposable workspace for the garbage-input sweep
let pool: string[] = []; // every id that belongs to workspace A
let aCounts: Record<string, number> = {};
const A_MODELS = ["contact", "conversation", "message", "messageTemplate", "campaign", "segment", "tag", "automation", "automationExecution", "flow", "flowSubmission", "aiAgent", "aiDocument", "aiInteraction", "appointment", "apiKey", "webhookEndpoint", "webhookDelivery", "invoice", "payment", "whatsAppAccount", "contactNote", "notification", "organizationMember", "consentRecord", "conversationAssignment"] as const;

async function tenant(name: string, withPlan: boolean) {
  const org = await makeOrg(name);
  const owner = await makeUser({ name: `${name} Owner` });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  if (withPlan) {
    const plan = await makePlan({ maxUsers: 20, maxWhatsAppNumbers: 3 });
    await db.plan.update({ where: { id: plan.id }, data: { maxContacts: 100_000 } });
    await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  }
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  return { orgId: org.id, owner };
}

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked in tests", { status: 502 })));
  admin = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
  loner = await makeUser({ name: "No workspace" });
  const a = await tenant("Sweep A", true);
  const agent = await makeUser({ name: "A Agent" });
  await addMember(a.orgId, agent.id, "AGENT");
  A = { ...a, agent };
  B = await tenant("Sweep B", true);
  C = await tenant("Sweep C", true);

  // Give workspace A a bit of everything.
  actAs(A.owner);
  const conn = await demoConnect.POST(req("/x", { method: "POST", body: { businessName: "Sweep Store" } }), params({ orgId: A.orgId }));
  expect(conn.status).toBe(201);
  const acct = await db.whatsAppAccount.findFirstOrThrow({ where: { organizationId: A.orgId } });
  await demoInbound.POST(req("/x", { method: "POST", body: { whatsappAccountId: acct.id, phone: "+919800000001", name: "Sweep Customer", body: "hello" } }), params({ orgId: A.orgId }));
  const contact = await db.contact.findFirstOrThrow({ where: { organizationId: A.orgId } });
  const waba = acct.wabaRecordId!;
  const tag = await db.tag.create({ data: { organizationId: A.orgId, name: "vip" } });
  await db.contactNote.create({ data: { organizationId: A.orgId, contactId: contact.id, authorUserId: A.owner.id, body: "note" } });
  const tpl = await db.messageTemplate.create({ data: { organizationId: A.orgId, wabaRecordId: waba, name: "sweep_tpl", language: "en", category: "UTILITY", status: "approved", body: "Hello" } });
  await db.segment.create({ data: { organizationId: A.orgId, name: "Seg", filters: "{}" } });
  await db.campaign.create({ data: { organizationId: A.orgId, name: "Camp", whatsappAccountId: acct.id, templateId: tpl.id } });
  const auto = await db.automation.create({ data: { organizationId: A.orgId, name: "Auto", triggerType: "keyword", whatsappAccountId: acct.id } });
  await db.automationExecution.create({ data: { organizationId: A.orgId, automationId: auto.id, graph: "{}", triggerType: "keyword", contactId: contact.id } });
  const flow = await db.flow.create({ data: { organizationId: A.orgId, wabaRecordId: waba, name: "Flow", category: "LEAD_GENERATION" } });
  await db.flowSubmission.create({ data: { organizationId: A.orgId, flowId: flow.id, contactId: contact.id, source: "demo" } });
  const agentRow = await db.aiAgent.create({ data: { organizationId: A.orgId, name: "Agent" } });
  await db.aiDocument.create({ data: { organizationId: A.orgId, agentId: agentRow.id, name: "doc", content: "x" } });
  await db.aiInteraction.create({ data: { organizationId: A.orgId, agentId: agentRow.id, mode: "demo", kind: "reply" } });
  await db.appointment.create({ data: { organizationId: A.orgId, contactId: contact.id, source: "ai" } });
  await db.apiKey.create({ data: { organizationId: A.orgId, name: "k", prefix: "mgk_sweep000", keyHash: "sweep-hash-a" } });
  const ep = await db.webhookEndpoint.create({ data: { organizationId: A.orgId, url: "https://hooks.example.com/a", events: "[]", secretEnc: "x" } });
  await db.webhookDelivery.create({ data: { organizationId: A.orgId, endpointId: ep.id, eventId: "evt_sweep", event: "message.received", payload: "{}", status: "failed" } });
  const inv = await db.invoice.create({ data: { organizationId: A.orgId, number: `INV-SWEEP-${Date.now()}`, dueAt: new Date(), total: 100 } });
  await db.payment.create({ data: { organizationId: A.orgId, invoiceId: inv.id, gateway: "x", amount: 100 } });
  await db.notification.create({ data: { userId: A.owner.id, organizationId: A.orgId, title: "n" } });
  void tag;

  const ids = new Set<string>([A.orgId]);
  aCounts = {};
  for (const m of A_MODELS) {
    const delegate = (db as unknown as Record<string, { findMany: (a: unknown) => Promise<{ id: string; userId?: string }[]>; count: (a: unknown) => Promise<number> }>)[m];
    const where = m === "notification" ? { userId: A.owner.id } : { organizationId: A.orgId };
    const rows = await delegate.findMany({ where });
    rows.forEach((r) => (ids.add(r.id), r.userId && ids.add(r.userId)));
    aCounts[m] = await delegate.count({ where });
  }
  [A.owner.id, A.agent.id].forEach((i) => ids.add(i));
  (await db.automationVersion.findMany({ where: { automation: { organizationId: A.orgId } }, select: { id: true } })).forEach((v) => ids.add(v.id));
  (await db.phoneNumber.findMany({ where: { organizationId: A.orgId }, select: { id: true } })).forEach((v) => ids.add(v.id));
  (await db.whatsAppBusinessAccount.findMany({ where: { organizationId: A.orgId }, select: { id: true } })).forEach((v) => ids.add(v.id));
  pool = [...ids];
  expect(pool.length).toBeGreaterThan(30);
});
afterAll(() => vi.unstubAllGlobals());

const status = (res: Response | null) => (res ? res.status : null);
const fmt = (xs: string[]) => (xs.length ? `\n  ${xs.slice(0, 25).join("\n  ")}${xs.length > 25 ? `\n  …and ${xs.length - 25} more` : ""}` : "");

describe("route inventory", () => {
  it("covers every API route", () => {
    expect(routes.length).toBeGreaterThan(150);
    expect(orgRoutes.length).toBeGreaterThan(90);
    expect(adminRoutes.length).toBeGreaterThan(20);
  });
});

describe("1. no session → no access", () => {
  it("every workspace, admin, profile and notification route answers 401", async () => {
    actAs(null);
    const bad: string[] = [];
    for (const r of sessionRoutes) {
      for (const m of await methodsOf(r)) {
        resetRateLimits();
        const res = await call(r, m, fill(r, { orgId: A.orgId }, "x1"), Object.fromEntries(r.dynamic.map((d) => [d, d === "orgId" ? A.orgId : "x1"])));
        if (status(res) !== 401) bad.push(`${m} ${r.path} → ${status(res)}`);
      }
    }
    expect(bad, fmt(bad)).toEqual([]);
  }, 120_000);
});

describe("2. tenant isolation", () => {
  it("a member of another workspace (or of none) can't use workspace A's id on any route", async () => {
    const bad: string[] = [];
    for (const who of [B.owner, loner]) {
      actAs(who);
      for (const r of orgRoutes) {
        for (const m of await methodsOf(r)) {
          resetRateLimits();
          const res = await call(r, m, fill(r, { orgId: A.orgId }, pool[1]), Object.fromEntries(r.dynamic.map((d) => [d, d === "orgId" ? A.orgId : pool[1]])));
          if (status(res) !== 403) bad.push(`${who === B.owner ? "B" : "loner"} ${m} ${r.path} → ${status(res)}`);
        }
      }
    }
    expect(bad, fmt(bad)).toEqual([]);
  }, 180_000);

  it("through its OWN workspace URL, B can't read, change or delete a single one of A's records", async () => {
    actAs(B.owner);
    const leaks: string[] = [];
    const idRoutes = orgRoutes.filter((r) => r.dynamic.length > 1);
    for (const r of idRoutes) {
      for (const m of await methodsOf(r)) {
        for (const id of pool) {
          resetRateLimits();
          const ctx = Object.fromEntries(r.dynamic.map((d) => [d, d === "orgId" ? B.orgId : id]));
          const res = await call(r, m, fill(r, ctx, id), ctx);
          const s = status(res);
          // 4xx (not found / invalid / refused) is right. 2xx would be a leak; 5xx a crash.
          if (s !== null && (s < 400 || s >= 500)) leaks.push(`${m} ${r.path} with ${id} → ${s}`);
        }
      }
    }
    expect(leaks, fmt(leaks)).toEqual([]);
    // …and nothing of A's changed.
    const after: Record<string, number> = {};
    for (const m of A_MODELS) {
      const delegate = (db as unknown as Record<string, { count: (a: unknown) => Promise<number> }>)[m];
      after[m] = await delegate.count({ where: m === "notification" ? { userId: A.owner.id } : { organizationId: A.orgId } });
    }
    expect(after).toEqual(aCounts);
  }, 600_000);
});

describe("3. admin area", () => {
  it("is closed to ordinary users and workspace owners", async () => {
    const bad: string[] = [];
    for (const who of [A.owner, A.agent, loner]) {
      actAs(who);
      for (const r of adminRoutes) {
        for (const m of await methodsOf(r)) {
          resetRateLimits();
          const res = await call(r, m, fill(r, {}, pool[1]), Object.fromEntries(r.dynamic.map((d) => [d, pool[1]])));
          if (status(res) !== 403) bad.push(`${m} ${r.path} → ${status(res)}`);
        }
      }
    }
    expect(bad, fmt(bad)).toEqual([]);
  }, 120_000);
});

describe("4. hostile input never produces a 5xx", () => {
  // Takes no body at all / only has optional fields of its own (none of the generic garbage keys apply).
  const NO_BODY_INPUT = new Set(["/api/admin/billing/cycle", "/api/admin/settings/payments"]);
  const bodies: [string, BodyInit][] = [
    ["empty object", "{}"],
    ["not JSON", "{not json"],
    ["wrong types", JSON.stringify({ name: 123, id: {}, email: [], status: null, phone: true, body: { a: 1 }, planId: 5, permissions: "x", events: 7, url: [], amount: "NaN" })],
    ["oversized strings", JSON.stringify({ name: "x".repeat(50_000), body: "y".repeat(50_000), url: "https://" + "z".repeat(5000) })],
  ];
  it("owner of a workspace, any route, any body, bogus ids → always a handled response", async () => {
    const crashes: string[] = [];
    for (const [who, label] of [[C.owner, "owner"], [admin, "admin"]] as const) {
      actAs(who);
      const list = label === "owner" ? orgRoutes : adminRoutes;
      for (const r of list) {
        for (const m of await methodsOf(r)) {
          for (const [what, body] of m === "GET" ? ([["no body", "{}"]] as [string, BodyInit][]) : bodies) {
            resetRateLimits();
            const ids = { orgId: C.orgId } as Record<string, string>;
            for (const d of r.dynamic) ids[d] ??= "bogus-id-1";
            const res = await call(r, m, fill(r, ids, "bogus-id-1") + (m === "GET" ? "?page=-1&pageSize=99999&days=abc&q=%00" : ""), ids, body);
            const s = status(res);
            if (s === null) continue;
            if (s >= 500) crashes.push(`${label} ${m} ${r.path} [${what}] → ${s}`);
            else if (s < 400 && m !== "GET" && !NO_BODY_INPUT.has(r.path) && what !== "empty object" && what !== "no body") crashes.push(`${label} ${m} ${r.path} [${what}] accepted garbage → ${s}`);
          }
        }
      }
    }
    expect(crashes, fmt(crashes)).toEqual([]);
  }, 900_000);

  it("responses use the standard error shape and never leak internals", async () => {
    actAs(C.owner);
    const r = orgRoutes.find((x) => x.path === "/api/organizations/[orgId]/contacts")!;
    const res = (await call(r, "POST", `/api/organizations/${C.orgId}/contacts`, { orgId: C.orgId }, "{not json"))!;
    const body = (await res.json()) as { error: string; code: string };
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(JSON.stringify(body)).not.toMatch(/stack|prisma|node_modules|\.ts:/i);
  });
});

describe("5. public and secret-protected surfaces", () => {
  it("webhooks, cron and hooks refuse callers without a valid signature or secret", async () => {
    actAs(null);
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    const cases: [string, string, string][] = [
      ["POST", "/api/webhooks/meta", "{}"],
      ["POST", "/api/webhooks/payments/razorpay", "{}"],
      ["POST", "/api/webhooks/payments/nope", "{}"],
      ["GET", "/api/cron/campaigns", ""],
      ["POST", "/api/automations/hooks/someid", "{}"],
    ];
    for (const [m, url, body] of cases) {
      const r = routes.find((x) => url.startsWith(x.path.replace(/\[.+?\]/g, "")) || x.path === url)!;
      const res = await call(r, m as "GET", url, Object.fromEntries(r.dynamic.map((d) => [d, d === "gateway" ? url.split("/").at(-1)! : "someid"])), body || undefined);
      expect([400, 401, 403, 404, 405, 429, 503], `${m} ${url} → ${res?.status}`).toContain(res?.status);
    }
    vi.unstubAllEnvs();
  });

  it("the public API refuses every request without a valid key", async () => {
    const v1 = group("/api/v1");
    expect(v1.length).toBeGreaterThanOrEqual(8);
    for (const r of v1) {
      for (const m of await methodsOf(r)) {
        resetRateLimits();
        const res = await call(r, m, fill(r, {}, "x"), Object.fromEntries(r.dynamic.map((d) => [d, "x"])));
        expect(res?.status, `${m} ${r.path}`).toBe(401);
      }
    }
  });

  it("anonymous password-reset requests are rate limited per IP", async () => {
    resetRateLimits();
    const route = (await routes.find((r) => r.path === "/api/auth/forgot-password")!.load()) as Mod;
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await route.POST!(new Request(`${BASE}/api/auth/forgot-password`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.200" }, body: JSON.stringify({ email: `nobody-${i}@example.com` }) }));
      codes.push(res.status);
      if (res.status === 429) expect(res.headers.get("retry-after")).toBeTruthy();
    }
    expect(codes.slice(0, 5).every((c) => c !== 429), codes.join(",")).toBe(true);
    expect(codes[5], codes.join(",")).toBe(429);
    resetRateLimits();
  });

  it("every other unauthenticated route is accounted for", () => {
    const names = PUBLIC_ROUTES.map((r) => r.path).sort();
    expect(names).toEqual(
      [
        "/api/auth/[...nextauth]",
        "/api/auth/forgot-password",
        "/api/auth/reset-password",
        "/api/automations/hooks/[aid]",
        "/api/cron/campaigns",
        "/api/health",
        "/api/webhooks/meta",
        "/api/webhooks/payments/[gateway]",
      ].sort()
    );
  });
});
