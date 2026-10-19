import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as overview from "@/app/api/organizations/[orgId]/ads-manager/route";
import * as connection from "@/app/api/organizations/[orgId]/ads-manager/connection/route";
import * as image from "@/app/api/organizations/[orgId]/ads-manager/image/route";
import * as campaigns from "@/app/api/organizations/[orgId]/ads-manager/campaigns/route";
import * as status from "@/app/api/organizations/[orgId]/ads-manager/campaigns/[adId]/status/route";
import * as sync from "@/app/api/organizations/[orgId]/ads-manager/campaigns/[adId]/sync/route";

afterEach(() => {
  vi.restoreAllMocks();
});

let n = 0;
const TOKEN = `EAAG${"a".repeat(70)}`;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });

async function tenant(opts: { service?: boolean } = {}) {
  const org = await makeOrg(`Ads ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const manager = await makeUser({ name: "Manager" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20 });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  if (opts.service !== false) await db.organizationService.create({ data: { organizationId: org.id, service: "ADS_MANAGER", enabled: true } });
  const waba = await db.whatsAppBusinessAccount.create({ data: { organizationId: org.id, wabaId: `w${Math.random()}`, name: "W" } });
  const wa = await db.whatsAppAccount.create({ data: { organizationId: org.id, wabaRecordId: waba.id, phoneNumber: `+9198${String(Date.now()).slice(-8)}`, displayName: "Shop", status: "connected" } });
  return { org, owner, manager, agent, wa };
}

type Call = { path: string; method: string; body?: Record<string, unknown> };
function graph(calls: Call[], opts: { failAt?: string } = {}) {
  let seq = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v[\d.]+\//, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ path, method, body });
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (opts.failAt && path.endsWith(opts.failAt) && method === "POST") return reply({ error: { message: "Invalid parameter", code: 100 } }, 400);
    if (method === "GET" && /^act_\d+$/.test(path)) return reply({ id: path, name: "Shop Ads", currency: "INR", account_status: 1 });
    if (method === "GET" && /insights$/.test(path)) return reply({ data: [{ spend: "123.45", impressions: "5000", clicks: "210" }] });
    if (method === "GET") return reply({ id: path, name: "Shop Page" });
    if (path.endsWith("/adimages")) return reply({ images: { "a.png": { hash: "abc123hash" } } });
    if (/\/(campaigns|adsets|adcreatives|ads)$/.test(path)) return reply({ id: `${path.split("/").pop()}_${++seq}` });
    return reply({ success: true });
  });
}
const connect = async (t: Awaited<ReturnType<typeof tenant>>) => {
  actAs(t.owner);
  return json(await connection.PUT(req("/x", { method: "PUT", body: { adAccountId: "123456789", pageId: "987654321", accessToken: TOKEN } }), P(t.org.id)));
};
const adBody = (t: Awaited<ReturnType<typeof tenant>>, over: Record<string, unknown> = {}) => ({ name: "Diwali offer", whatsappAccountId: t.wa.id, dailyBudgetRupees: 500, message: "Get 20% off this Diwali. Message us!", headline: "Diwali sale", imageHash: "abc123hash", ...over });

describe("Ads Manager", () => {
  it("connects after Meta verifies the account, encrypts the token and never returns it", async () => {
    graph([]);
    const t = await tenant();
    const r = await connect(t);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
    expect(r.body.connection).toMatchObject({ adAccountId: "123456789", pageId: "987654321", currency: "INR" });
    const row = await db.adConnection.findUniqueOrThrow({ where: { organizationId: t.org.id } });
    expect(row.encryptedToken).not.toContain(TOKEN);
    // Managers can't connect; agents see nothing.
    actAs(t.manager);
    expect((await connection.PUT(req("/x", { method: "PUT", body: { adAccountId: "123456789", pageId: "987654321", accessToken: TOKEN } }), P(t.org.id))).status).toBe(403);
    actAs(t.agent);
    expect((await overview.GET(req("/x"), P(t.org.id))).status).toBe(403);
  });

  it("refuses an account Meta rejects, and a workspace without the service", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 400 }));
    const t = await tenant();
    expect((await connect(t)).status).toBe(400);
    const off = await tenant({ service: false });
    expect((await connect(off)).status).toBe(403);
  });

  it("creates the ad PAUSED through all four Meta steps, then starts only after the budget is confirmed", async () => {
    const calls: Call[] = [];
    graph(calls);
    const t = await tenant();
    await connect(t);
    actAs(t.manager);
    const created = await json(await campaigns.POST(post(adBody(t)), P(t.org.id)));
    expect(created.status).toBe(201);
    const ad = created.body.ad as { id: string; status: string; metaAdId: string; dailyBudget: number };
    expect(ad).toMatchObject({ status: "paused", dailyBudget: 50_000 });
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => c.path.split("/").pop())).toEqual(["campaigns", "adsets", "adcreatives", "ads"]);
    expect(posts.every((c) => c.body?.status === "PAUSED" || c.path.endsWith("adcreatives"))).toBe(true);
    const adset = posts[1].body as { daily_budget: number; destination_type: string; promoted_object: { page_id: string; whatsapp_phone_number: string }; optimization_goal: string };
    expect(adset).toMatchObject({ daily_budget: 50_000, destination_type: "WHATSAPP", optimization_goal: "CONVERSATIONS", promoted_object: { page_id: "987654321", whatsapp_phone_number: t.wa.phoneNumber } });
    expect(JSON.stringify(posts[2].body)).toContain("WHATSAPP_MESSAGE");

    // Starting needs the confirmation.
    expect((await status.POST(post({ action: "activate" }), P(t.org.id, { adId: ad.id }))).status).toBe(400);
    expect((await status.POST(post({ action: "activate", confirmBudget: true }), P(t.org.id, { adId: ad.id }))).status).toBe(200);
    expect((await db.adCampaign.findUniqueOrThrow({ where: { id: ad.id } })).status).toBe("active");
    expect((await status.POST(post({ action: "pause" }), P(t.org.id, { adId: ad.id }))).status).toBe(200);
    expect((await db.adCampaign.findUniqueOrThrow({ where: { id: ad.id } })).status).toBe("paused");
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "ads.status_changed" } })).toBe(2);
  });

  it("keeps Meta's error, archives what was half-built, and marks the ad failed", async () => {
    const calls: Call[] = [];
    graph(calls, { failAt: "/adcreatives" });
    const t = await tenant();
    await connect(t);
    actAs(t.owner);
    const r = await json(await campaigns.POST(post(adBody(t)), P(t.org.id)));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain("Invalid parameter");
    const row = await db.adCampaign.findFirstOrThrow({ where: { organizationId: t.org.id } });
    expect(row).toMatchObject({ status: "failed" });
    expect(row.lastError).toContain("Invalid parameter");
    expect(calls.some((c) => c.body?.status === "ARCHIVED")).toBe(true);
  });

  it("validates budget, age, number and image; rejects extra fields", async () => {
    graph([]);
    const t = await tenant();
    await connect(t);
    const other = await tenant();
    actAs(t.owner);
    for (const bad of [adBody(t, { dailyBudgetRupees: 50 }), adBody(t, { dailyBudgetRupees: 20_000 }), adBody(t, { ageMin: 40, ageMax: 30 }), adBody(t, { imageHash: "bad hash!" }), adBody(t, { extra: 1 }), adBody(t, { whatsappAccountId: other.wa.id }), adBody(t, { name: "x" })]) {
      expect((await campaigns.POST(post(bad), P(t.org.id))).status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
    await db.whatsAppAccount.update({ where: { id: t.wa.id }, data: { isDemo: true } });
    expect((await campaigns.POST(post(adBody(t)), P(t.org.id))).status).toBe(400);
  });

  it("syncs spend from Meta and shows chats and cost per chat from the click-to-WhatsApp referrals", async () => {
    graph([]);
    const t = await tenant();
    await connect(t);
    actAs(t.owner);
    const ad = ((await json(await campaigns.POST(post(adBody(t)), P(t.org.id)))).body.ad as { id: string; metaAdId: string });
    const c = await db.contact.create({ data: { organizationId: t.org.id, phone: `+9197${String(Date.now()).slice(-8)}` } });
    const conv = await db.conversation.create({ data: { organizationId: t.org.id, contactId: c.id, whatsappAccountId: t.wa.id } });
    for (let i = 0; i < 3; i++) {
      const m = await db.message.create({ data: { organizationId: t.org.id, conversationId: conv.id, direction: "inbound", type: "text", body: "hi", externalId: `ads-${n}-${i}-${Math.random()}` } });
      await db.adReferral.create({ data: { organizationId: t.org.id, conversationId: conv.id, contactId: c.id, messageId: m.id, sourceType: "ad", sourceId: ad.metaAdId } });
    }
    const s = await json(await sync.POST(post({}), P(t.org.id, { adId: ad.id })));
    expect(s.body.ad).toMatchObject({ spend: 12_345, impressions: 5000, clicks: 210, chats: 3, costPerChat: 4115 });
  });

  it("uploads an image (JPG/PNG only) and is tenant-isolated", async () => {
    graph([]);
    const t = await tenant();
    await connect(t);
    const other = await tenant();
    await connect(other);
    actAs(t.owner);
    const fd = (file: File) => {
      const f = new FormData();
      f.set("file", file);
      return new Request("http://localhost:3000/x", { method: "POST", headers: { host: "localhost:3000" }, body: f });
    };
    expect((await json(await image.POST(fd(new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" })), P(t.org.id)))).body).toEqual({ hash: "abc123hash" });
    expect((await image.POST(fd(new File(["x"], "a.gif", { type: "image/gif" })), P(t.org.id))).status).toBe(400);
    const ad = ((await json(await campaigns.POST(post(adBody(t)), P(t.org.id)))).body.ad as { id: string });
    actAs(other.owner);
    expect((await status.POST(post({ action: "pause" }), P(other.org.id, { adId: ad.id }))).status).toBe(404);
    expect(((await json(await overview.GET(req("/x"), P(other.org.id)))).body.campaigns as unknown[]).length).toBe(0);
  });
});
