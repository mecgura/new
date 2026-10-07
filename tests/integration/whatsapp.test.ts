import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as statusRoute from "@/app/api/organizations/[orgId]/whatsapp/route";
import * as startRoute from "@/app/api/organizations/[orgId]/whatsapp/connect/meta/start/route";
import * as completeRoute from "@/app/api/organizations/[orgId]/whatsapp/connect/meta/complete/route";
import * as cancelRoute from "@/app/api/organizations/[orgId]/whatsapp/connect/meta/cancel/route";
import * as manualRoute from "@/app/api/organizations/[orgId]/whatsapp/connect/manual/route";
import * as demoRoute from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as accountRoute from "@/app/api/organizations/[orgId]/whatsapp/accounts/[accountId]/route";
import * as disconnectRoute from "@/app/api/organizations/[orgId]/whatsapp/accounts/[accountId]/disconnect/route";
import * as webhookInfoRoute from "@/app/api/organizations/[orgId]/whatsapp/accounts/[accountId]/webhook/route";
import * as metaWebhook from "@/app/api/webhooks/meta/route";
import * as adminNumber from "@/app/api/admin/whatsapp-accounts/[id]/route";
import * as adminRegistry from "@/app/api/admin/organizations/[id]/whatsapp-accounts/route";

let seq = 0;
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
const metaIds = () => ({ wabaId: `1${digits(14)}`, phoneNumberId: `2${digits(14)}`, local: `9${digits(9)}` });
const TOKEN = () => `EAAG${randomBytes(60).toString("hex")}`;
const APP_SECRET = () => randomBytes(16).toString("hex");

async function makeTenant(opts: { maxNumbers?: number; service?: boolean } = {}) {
  const org = await makeOrg(`WA Tenant ${seq++}`);
  const owner = await makeUser({ name: "WA Owner" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  const plan = await makePlan({ maxWhatsAppNumbers: opts.maxNumbers ?? 3, maxUsers: 20 });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: opts.service ?? true } });
  return { org, owner };
}

type GraphCall = { method: string; url: URL; auth: string | null };
let calls: GraphCall[] = [];

/** Fake Graph API. Only graph.facebook.com is intercepted. */
function mockMeta(cfg: { wabaId: string; phoneNumberId: string; local: string; token?: string; fail?: { status: number; message: string }; phoneOutsideWaba?: boolean }) {
  calls = [];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "graph.facebook.com") throw new Error(`unexpected fetch ${url}`);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, auth: new Headers(init?.headers).get("authorization") });
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (cfg.fail) return reply({ error: { message: cfg.fail.message, code: 100 } }, cfg.fail.status);
    const path = url.pathname.replace(/^\/v[\d.]+\//, "");
    if (path === "oauth/access_token") return reply({ access_token: cfg.token ?? "EAAG-exchanged-token-xyz" });
    if (path === `${cfg.wabaId}/subscribed_apps`) return reply({ success: true });
    if (path === `${cfg.wabaId}/phone_numbers`) return reply({ data: cfg.phoneOutsideWaba ? [] : [{ id: cfg.phoneNumberId }] });
    if (path === cfg.wabaId) return reply({ id: cfg.wabaId, name: "Jay Shri Enterprises", currency: "INR", timezone_id: "71", owner_business_info: { id: "998877", name: "Jay Shri" } });
    if (path === cfg.phoneNumberId) {
      return reply({ id: cfg.phoneNumberId, display_phone_number: `+91 ${cfg.local.slice(0, 5)} ${cfg.local.slice(5)}`, verified_name: "Jay Shri", quality_rating: "GREEN", messaging_limit_tier: "TIER_1K", code_verification_status: "VERIFIED" });
    }
    return reply({ error: { message: "Unknown path" } }, 404);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const p = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });

async function connectManual(orgId: string, ids = metaIds(), extra: Record<string, unknown> = {}) {
  const token = TOKEN();
  const secret = APP_SECRET();
  mockMeta(ids);
  const res = await json(await manualRoute.POST(post({ wabaId: ids.wabaId, phoneNumberId: ids.phoneNumberId, accessToken: token, appSecret: secret, ...extra }), p(orgId)));
  return { ...res, token, secret, ids, accountId: (res.body.account as { id: string } | undefined)?.id ?? "" };
}

describe("connection center status", () => {
  it("reports setup/demo state without leaking configuration values", async () => {
    const { org, owner } = await makeTenant();
    actAs(owner);
    const { status, body } = await json(await statusRoute.GET(req("/x"), p(org.id)));
    expect(status).toBe(200);
    expect(body).toMatchObject({ serviceEnabled: true, canManage: true, demoAvailable: true, meta: { configured: false } });
    expect((body.meta as { missing: string[] }).missing).toContain("META_APP_ID");
  });
});

describe("demo connection", () => {
  it("creates clearly-labelled demo records without calling Meta", async () => {
    const { org, owner } = await makeTenant();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    actAs(owner);
    const { status, body } = await json(await demoRoute.POST(post({ businessName: "Jay Shri Demo" }), p(org.id)));
    expect(status).toBe(201);
    expect(fetchSpy).not.toHaveBeenCalled();
    const acc = body.account as { id: string; status: string; isDemo: boolean; wabaId: string; e164: string };
    expect(acc).toMatchObject({ status: "demo", isDemo: true });
    expect(acc.wabaId.startsWith("DEMO-")).toBe(true);
    const row = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: acc.id }, include: { connection: true, waba: true, phone: true } });
    expect(row.connection).toMatchObject({ method: "demo", isDemo: true, status: "active", encryptedAccessToken: "" });
    expect(row.waba?.isDemo).toBe(true);
    expect(row.phone?.isDemo).toBe(true);
    expect(await db.auditLog.count({ where: { organizationId: org.id, action: "whatsapp.connected" } })).toBe(1);
  });

  it("is refused when demo mode is switched off", async () => {
    vi.stubEnv("WHATSAPP_DEMO_MODE", "off");
    const { org, owner } = await makeTenant();
    actAs(owner);
    expect((await demoRoute.POST(post({ businessName: "Nope" }), p(org.id))).status).toBe(403);
  });
});

describe("multiple accounts per client", () => {
  it("supports several numbers up to the plan limit; disconnecting frees a slot", async () => {
    const { org, owner } = await makeTenant({ maxNumbers: 3 });
    actAs(owner);
    expect((await demoRoute.POST(post({ businessName: "Branch A" }), p(org.id))).status).toBe(201);
    expect((await demoRoute.POST(post({ businessName: "Branch B" }), p(org.id))).status).toBe(201);
    const manual = await connectManual(org.id);
    expect(manual.status).toBe(201);
    const over = await json(await demoRoute.POST(post({ businessName: "Branch D" }), p(org.id)));
    expect(over.status).toBe(409);
    expect(String(over.body.error)).toMatch(/plan allows 3/);

    const status = await json(await statusRoute.GET(req("/x"), p(org.id)));
    expect((status.body.accounts as unknown[]).length).toBe(3);
    expect(new Set((status.body.accounts as { wabaId: string }[]).map((a) => a.wabaId)).size).toBe(3);

    mockMeta(manual.ids);
    expect((await disconnectRoute.POST(post({}), p(org.id, { accountId: manual.accountId }))).status).toBe(200);
    expect((await demoRoute.POST(post({ businessName: "Branch D" }), p(org.id))).status).toBe(201);
  });
});

describe("API / developer setup + secure credentials", () => {
  it("validates input (400) before calling Meta", async () => {
    const { org, owner } = await makeTenant();
    const spy = vi.spyOn(globalThis, "fetch");
    actAs(owner);
    const res = await json(await manualRoute.POST(post({ wabaId: "abc", phoneNumberId: "1", accessToken: "short", appSecret: "zz" }), p(org.id)));
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.details as object)).toEqual(expect.arrayContaining(["wabaId", "phoneNumberId", "accessToken", "appSecret"]));
    expect(spy).not.toHaveBeenCalled();
  });

  it("Meta rejection → 400 with Meta's message, nothing stored", async () => {
    const { org, owner } = await makeTenant();
    actAs(owner);
    const ids = metaIds();
    mockMeta({ ...ids, fail: { status: 400, message: "Invalid OAuth access token." } });
    const res = await json(await manualRoute.POST(post({ wabaId: ids.wabaId, phoneNumberId: ids.phoneNumberId, accessToken: TOKEN() }), p(org.id)));
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("Invalid OAuth access token");
    expect(await db.whatsAppConnection.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { organizationId: org.id, action: "whatsapp.connect_failed" } })).toBe(1);
  });

  it("rejects a phone number that isn't in the WABA", async () => {
    const { org, owner } = await makeTenant();
    actAs(owner);
    const ids = metaIds();
    mockMeta({ ...ids, phoneOutsideWaba: true });
    expect((await manualRoute.POST(post({ wabaId: ids.wabaId, phoneNumberId: ids.phoneNumberId, accessToken: TOKEN() }), p(org.id))).status).toBe(400);
  });

  it("stores the token encrypted, never returns it, and sends it only in the Authorization header", async () => {
    const { org, owner } = await makeTenant();
    actAs(owner);
    const r = await connectManual(org.id);
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain(r.token);
    expect(JSON.stringify(r.body)).not.toContain(r.secret);
    for (const c of calls) {
      expect(c.url.toString()).not.toContain(r.token);
      expect(c.auth).toBe(`Bearer ${r.token}`);
    }
    const conn = await db.whatsAppConnection.findFirstOrThrow({ where: { organizationId: org.id, method: "manual" } });
    expect(conn.encryptedAccessToken).not.toContain(r.token.slice(4, 30));
    expect(decryptSecret(conn.encryptedAccessToken)).toBe(r.token);
    expect(decryptSecret(conn.encryptedAppSecret)).toBe(r.secret);
    expect(conn.tokenLast4).toBe(r.token.slice(-4));

    const got = await json(await accountRoute.GET(req("/x"), p(org.id, { accountId: r.accountId })));
    expect(JSON.stringify(got.body)).not.toContain(r.token);
    expect((got.body.account as { connection: { tokenHint: string } }).connection.tokenHint).toBe(`••••${r.token.slice(-4)}`);
    const st = await json(await statusRoute.GET(req("/x"), p(org.id)));
    expect(JSON.stringify(st.body)).not.toContain(r.token);

    const logs = await db.auditLog.findMany({ where: { organizationId: org.id } });
    expect(JSON.stringify(logs)).not.toContain(r.token);
  });

  it("issues a per-connection webhook verify token visible only to owners", async () => {
    const { org, owner } = await makeTenant();
    const agent = await makeUser();
    await addMember(org.id, agent.id, "AGENT");
    actAs(owner);
    const r = await connectManual(org.id);
    const wh = await json(await webhookInfoRoute.GET(req("/x"), p(org.id, { accountId: r.accountId })));
    expect(wh.status).toBe(200);
    const info = wh.body.webhook as { verifyToken: string; callbackUrl: string; mode: string; signatureSecretStored: boolean };
    expect(info.mode).toBe("own_app");
    expect(info.callbackUrl).toMatch(/\/api\/webhooks\/meta$/);
    expect(info.verifyToken.length).toBeGreaterThan(20);
    expect(info.signatureSecretStored).toBe(true);
    expect(JSON.stringify(wh.body)).not.toContain(r.token);
    actAs(agent);
    expect((await webhookInfoRoute.GET(req("/x"), p(org.id, { accountId: r.accountId }))).status).toBe(403);
  });

  it("claims a Phase 2 'pending' registry entry for the same number", async () => {
    const { org, owner } = await makeTenant();
    const admin = await makeUser({ role: "SUPER_ADMIN" });
    const ids = metaIds();
    actAs(admin);
    const reg = await json(await adminRegistry.POST(req("/x", { method: "POST", body: { displayName: "Sales", phoneNumber: `+91${ids.local}` } }), params({ id: org.id })));
    expect(reg.status).toBe(201);
    const regId = (reg.body.account as { id: string }).id;
    actAs(owner);
    const r = await connectManual(org.id, ids);
    expect(r.accountId).toBe(regId);
    const row = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: regId } });
    expect(row).toMatchObject({ status: "connected", displayName: "Sales", wabaId: ids.wabaId });
    // Connected numbers can no longer be toggled from the admin registry.
    actAs(admin);
    expect((await adminNumber.PATCH(req("/x", { method: "PATCH", body: { status: "disabled" } }), params({ id: regId }))).status).toBe(409);
  });

  it("a WABA connected to one client can't be connected to another", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const ids = metaIds();
    actAs(a.owner);
    expect((await connectManual(a.org.id, ids)).status).toBe(201);
    actAs(b.owner);
    expect((await connectManual(b.org.id, ids)).status).toBe(409);
  });
});

describe("Meta Embedded Signup", () => {
  const configure = () => {
    vi.stubEnv("META_APP_ID", "1234567890");
    vi.stubEnv("META_APP_SECRET", "abcdefabcdefabcdefabcdefabcdef12");
    vi.stubEnv("META_EMBEDDED_SIGNUP_CONFIG_ID", "555666777");
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "platform-verify-token");
  };

  it("is unavailable (503) until Meta is configured — never faked", async () => {
    const { org, owner } = await makeTenant();
    actAs(owner);
    expect((await startRoute.POST(post({ method: "embedded_signup" }), p(org.id))).status).toBe(503);
  });

  it("start → complete (server-side code exchange) → connected; state is single-use", async () => {
    configure();
    const { org, owner } = await makeTenant();
    actAs(owner);
    const start = await json(await startRoute.POST(post({ method: "embedded_signup" }), p(org.id)));
    expect(start.status).toBe(200);
    expect(start.body.meta).toEqual({ appId: "1234567890", configId: "555666777", graphVersion: expect.any(String) });
    expect(JSON.stringify(start.body)).not.toMatch(/abcdefabcdef|platform-verify-token/);
    const state = start.body.state as string;

    const ids = metaIds();
    mockMeta({ ...ids, token: "EAAG-exchanged-token-xyz" });
    const done = await json(await completeRoute.POST(post({ state, code: "AQD-code-from-meta", ...ids }), p(org.id)));
    expect(done.status).toBe(201);
    expect(done.body.account).toMatchObject({ status: "connected", quality: "GREEN", connection: { method: "embedded_signup" } });
    expect(JSON.stringify(done.body)).not.toContain("EAAG-exchanged-token-xyz");
    const exchange = calls.find((c) => c.url.pathname.endsWith("oauth/access_token"))!;
    expect(exchange.url.searchParams.get("code")).toBe("AQD-code-from-meta");
    expect(calls.some((c) => c.method === "POST" && c.url.pathname.endsWith("/subscribed_apps"))).toBe(true);
    const conn = await db.whatsAppConnection.findFirstOrThrow({ where: { organizationId: org.id, method: "embedded_signup" }, include: { webhook: true } });
    expect(decryptSecret(conn.encryptedAccessToken)).toBe("EAAG-exchanged-token-xyz");
    expect(conn.webhook?.status).toBe("subscribed");

    expect((await completeRoute.POST(post({ state, code: "AQD-code-from-meta", ...ids }), p(org.id))).status).toBe(400);
  });

  it("rejects a state from another organization and expired states", async () => {
    configure();
    const a = await makeTenant();
    const b = await makeTenant();
    actAs(a.owner);
    const { body } = await json(await startRoute.POST(post({ method: "coexistence" }), p(a.org.id)));
    expect(body.featureType).toBe("whatsapp_business_app_onboarding");
    actAs(b.owner);
    const ids = metaIds();
    expect((await completeRoute.POST(post({ state: body.state, code: "AQD-code-123", ...ids }), p(b.org.id))).status).toBe(400);

    actAs(a.owner);
    const s2 = await json(await startRoute.POST(post({ method: "embedded_signup" }), p(a.org.id)));
    await db.whatsAppConnection.updateMany({ where: { organizationId: a.org.id, status: "pending" }, data: { stateExpiresAt: new Date(Date.now() - 1000) } });
    expect((await completeRoute.POST(post({ state: s2.body.state, code: "AQD-code-123", ...ids }), p(a.org.id))).status).toBe(400);
  });

  it("failed exchange marks the attempt failed; cancel marks it cancelled", async () => {
    configure();
    const { org, owner } = await makeTenant();
    actAs(owner);
    const s = await json(await startRoute.POST(post({ method: "embedded_signup" }), p(org.id)));
    const ids = metaIds();
    mockMeta({ ...ids, fail: { status: 400, message: "This authorization code has expired." } });
    const r = await json(await completeRoute.POST(post({ state: s.body.state, code: "AQD-expired", ...ids }), p(org.id)));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain("expired");
    expect((await db.whatsAppConnection.findFirstOrThrow({ where: { organizationId: org.id } })).status).toBe("failed");

    const s2 = await json(await startRoute.POST(post({ method: "embedded_signup" }), p(org.id)));
    expect((await cancelRoute.POST(post({ state: s2.body.state, reason: "Cancelled at PHONE_NUMBER_SETUP" }), p(org.id))).status).toBe(200);
    expect(await db.whatsAppConnection.count({ where: { organizationId: org.id, status: "cancelled" } })).toBe(1);
  });
});

describe("disconnect", () => {
  it("wipes credentials, unsubscribes at Meta, frees the slot and is audited", async () => {
    const { org, owner } = await makeTenant();
    actAs(owner);
    const r = await connectManual(org.id);
    mockMeta(r.ids);
    const d = await json(await disconnectRoute.POST(post({}), p(org.id, { accountId: r.accountId })));
    expect(d.status).toBe(200);
    expect(d.body.account).toMatchObject({ status: "disconnected" });
    expect(calls.some((c) => c.method === "DELETE" && c.url.pathname.endsWith("/subscribed_apps") && c.auth === `Bearer ${r.token}`)).toBe(true);
    const conn = await db.whatsAppConnection.findFirstOrThrow({ where: { organizationId: org.id, method: "manual" }, include: { webhook: true } });
    expect(conn).toMatchObject({ status: "disconnected", encryptedAccessToken: "", encryptedAppSecret: "", tokenLast4: "" });
    expect(conn.webhook).toMatchObject({ status: "disabled", verifyTokenHash: "", encryptedVerifyToken: "" });
    expect(await db.auditLog.count({ where: { organizationId: org.id, action: "whatsapp.disconnected" } })).toBe(1);
    // Idempotent
    expect((await disconnectRoute.POST(post({}), p(org.id, { accountId: r.accountId }))).status).toBe(200);
    expect(await db.auditLog.count({ where: { organizationId: org.id, action: "whatsapp.disconnected" } })).toBe(1);
  });

  it("still disconnects locally when Meta is unreachable", async () => {
    const { org, owner } = await makeTenant();
    actAs(owner);
    const r = await connectManual(org.id);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    expect((await disconnectRoute.POST(post({}), p(org.id, { accountId: r.accountId }))).status).toBe(200);
    expect((await db.whatsAppAccount.findUniqueOrThrow({ where: { id: r.accountId } })).status).toBe("disconnected");
  });
});

describe("roles & service gating", () => {
  it("MANAGER/AGENT can view but not connect, change or disconnect", async () => {
    const { org, owner } = await makeTenant();
    actAs(owner);
    const demo = await json(await demoRoute.POST(post({ businessName: "Main" }), p(org.id)));
    const accountId = (demo.body.account as { id: string }).id;
    for (const role of ["MANAGER", "AGENT"] as const) {
      const u = await makeUser();
      await addMember(org.id, u.id, role);
      actAs(u);
      const st = await json(await statusRoute.GET(req("/x"), p(org.id)));
      expect(st.status).toBe(200);
      expect(st.body.canManage).toBe(false);
      expect((await accountRoute.GET(req("/x"), p(org.id, { accountId }))).status).toBe(200);
      expect((await demoRoute.POST(post({ businessName: "X" }), p(org.id))).status).toBe(403);
      expect((await manualRoute.POST(post({}), p(org.id))).status).toBe(403);
      expect((await accountRoute.PATCH(req("/x", { method: "PATCH", body: { displayName: "Hacked" } }), p(org.id, { accountId }))).status).toBe(403);
      expect((await disconnectRoute.POST(post({}), p(org.id, { accountId }))).status).toBe(403);
    }
    expect((await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } })).status).toBe("demo");
  });

  it("WhatsApp Automation service must be enabled", async () => {
    const { org, owner } = await makeTenant({ service: false });
    actAs(owner);
    const r = await json(await demoRoute.POST(post({ businessName: "Valid Name" }), p(org.id)));
    expect(r.status).toBe(403);
    expect(String(r.body.error)).toContain("isn't enabled");
  });
});

describe("tenant isolation", () => {
  it("Tenant B can't read, rename or disconnect Tenant A's numbers by any path", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    actAs(a.owner);
    const r = await connectManual(a.org.id);
    actAs(b.owner);
    // A's org path → 403
    expect((await statusRoute.GET(req("/x"), p(a.org.id))).status).toBe(403);
    expect((await accountRoute.GET(req("/x"), p(a.org.id, { accountId: r.accountId }))).status).toBe(403);
    expect((await disconnectRoute.POST(post({}), p(a.org.id, { accountId: r.accountId }))).status).toBe(403);
    expect((await webhookInfoRoute.GET(req("/x"), p(a.org.id, { accountId: r.accountId }))).status).toBe(403);
    // Own org path with A's account id → 404
    expect((await accountRoute.GET(req("/x"), p(b.org.id, { accountId: r.accountId }))).status).toBe(404);
    expect((await accountRoute.PATCH(req("/x", { method: "PATCH", body: { displayName: "Mine" } }), p(b.org.id, { accountId: r.accountId }))).status).toBe(404);
    expect((await disconnectRoute.POST(post({}), p(b.org.id, { accountId: r.accountId }))).status).toBe(404);
    expect((await webhookInfoRoute.GET(req("/x"), p(b.org.id, { accountId: r.accountId }))).status).toBe(404);
    // B's list never includes A's numbers
    const list = await json(await statusRoute.GET(req("/x"), p(b.org.id)));
    expect((list.body.accounts as { id: string }[]).some((x) => x.id === r.accountId)).toBe(false);
    expect((await db.whatsAppAccount.findUniqueOrThrow({ where: { id: r.accountId } })).status).toBe("connected");
  });
});

describe("webhook endpoint /api/webhooks/meta", () => {
  const verify = (q: Record<string, string>) => metaWebhook.GET(new Request(`http://localhost:3000/api/webhooks/meta?${new URLSearchParams(q)}`));
  const signed = (body: object, secret: string, sigOverride?: string) => {
    const raw = JSON.stringify(body);
    return new Request("http://localhost:3000/api/webhooks/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": sigOverride ?? `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` },
      body: raw,
    });
  };
  const envelope = (wabaId: string, value: Record<string, unknown>, field = "messages") => ({ object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field, value }] }] });

  it("GET verification: platform token and per-connection token succeed; anything else is 403", async () => {
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "platform-verify-token");
    const ok1 = await verify({ "hub.mode": "subscribe", "hub.verify_token": "platform-verify-token", "hub.challenge": "1158201444" });
    expect(ok1.status).toBe(200);
    expect(await ok1.text()).toBe("1158201444");
    expect((await verify({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1" })).status).toBe(403);
    expect((await verify({ "hub.mode": "unsubscribe", "hub.verify_token": "platform-verify-token", "hub.challenge": "1" })).status).toBe(403);
    expect((await verify({ "hub.mode": "subscribe", "hub.verify_token": "platform-verify-token", "hub.challenge": "<script>" })).status).toBe(403);

    const { org, owner } = await makeTenant();
    actAs(owner);
    const r = await connectManual(org.id);
    const info = await json(await webhookInfoRoute.GET(req("/x"), p(org.id, { accountId: r.accountId })));
    const token = (info.body.webhook as { verifyToken: string }).verifyToken;
    const ok2 = await verify({ "hub.mode": "subscribe", "hub.verify_token": token, "hub.challenge": "42" });
    expect(await ok2.text()).toBe("42");
    expect((await db.webhookConfiguration.findFirstOrThrow({ where: { organizationId: org.id } })).status).toBe("verified");
  });

  it("POST requires a valid signature", async () => {
    const { org, owner } = await makeTenant();
    actAs(owner);
    const r = await connectManual(org.id);
    const body = envelope(r.ids.wabaId, { metadata: { phone_number_id: r.ids.phoneNumberId }, statuses: [{ id: "wamid.unsigned", status: "sent" }] });
    expect((await metaWebhook.POST(signed(body, r.secret, "sha256=deadbeef"))).status).toBe(401);
    expect((await metaWebhook.POST(signed(body, "0".repeat(32)))).status).toBe(401);
    const noSig = new Request("http://localhost:3000/api/webhooks/meta", { method: "POST", body: JSON.stringify(body) });
    expect((await metaWebhook.POST(noSig)).status).toBe(401);
    expect(await db.webhookEvent.count({ where: { dedupeKey: "meta:status:wamid.unsigned:sent" } })).toBe(0);
    expect((await metaWebhook.POST(new Request("http://localhost:3000/api/webhooks/meta", { method: "POST", body: "{not json" }))).status).toBe(400);
  });

  it("processes signed status/message/quality events idempotently", async () => {
    const { org, owner } = await makeTenant();
    actAs(owner);
    const r = await connectManual(org.id);
    const sent = envelope(r.ids.wabaId, { metadata: { phone_number_id: r.ids.phoneNumberId }, statuses: [{ id: `wamid.s${seq++}`, status: "sent", recipient_id: "919999999999" }] });
    const res = await json(await metaWebhook.POST(signed(sent, r.secret)));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 1, duplicates: 0 });
    const dup = await json(await metaWebhook.POST(signed(sent, r.secret)));
    expect(dup.body).toEqual({ received: 1, duplicates: 1 });

    const inbound = envelope(r.ids.wabaId, { metadata: { phone_number_id: r.ids.phoneNumberId }, messages: [{ id: `wamid.m${seq++}`, from: "919999999999", type: "text", timestamp: "1" }] });
    expect((await metaWebhook.POST(signed(inbound, r.secret))).status).toBe(200);
    const quality = envelope(r.ids.wabaId, { display_phone_number: `+91 ${r.ids.local}`, event: "UPGRADE", current_limit: "TIER_10K" }, "phone_number_quality_update");
    expect((await metaWebhook.POST(signed(quality, r.secret))).status).toBe(200);

    const phone = await db.phoneNumber.findUniqueOrThrow({ where: { phoneNumberId: r.ids.phoneNumberId } });
    expect(phone).toMatchObject({ messagesSent: 1, messagesReceived: 1, messagingLimitTier: "TIER_10K", lastQualityEvent: "UPGRADE" });
    const usage = await db.usageCounter.aggregate({ where: { organizationId: org.id, metric: "messages_sent" }, _sum: { value: true } });
    expect(usage._sum.value).toBe(1);
    const events = await db.webhookEvent.findMany({ where: { organizationId: org.id } });
    expect(events.every((e) => e.status === "processed")).toBe(true);
    expect((await db.webhookConfiguration.findFirstOrThrow({ where: { organizationId: org.id } })).lastEventAt).not.toBeNull();
  });

  it("signed events for unknown WABAs are stored as ignored (platform secret)", async () => {
    vi.stubEnv("META_APP_SECRET", "platformsecretplatformsecret1234");
    const body = envelope("9999999999999", { metadata: { phone_number_id: "1" }, statuses: [{ id: `wamid.u${seq++}`, status: "sent" }] });
    const res = await metaWebhook.POST(signed(body, "platformsecretplatformsecret1234"));
    expect(res.status).toBe(200);
    const ev = await db.webhookEvent.findFirstOrThrow({ where: { wabaId: "9999999999999" } });
    expect(ev).toMatchObject({ status: "ignored", organizationId: null });
  });

  it("disconnected connections' app secrets no longer validate webhooks", async () => {
    const { org, owner } = await makeTenant();
    actAs(owner);
    const r = await connectManual(org.id);
    mockMeta(r.ids);
    await disconnectRoute.POST(post({}), p(org.id, { accountId: r.accountId }));
    const body = envelope(r.ids.wabaId, { metadata: { phone_number_id: r.ids.phoneNumberId }, statuses: [{ id: `wamid.d${seq++}`, status: "sent" }] });
    expect((await metaWebhook.POST(signed(body, r.secret))).status).toBe(401);
  });
});
