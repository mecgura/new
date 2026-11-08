import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as overview from "@/app/api/organizations/[orgId]/ads-manager/route";
import * as connection from "@/app/api/organizations/[orgId]/ads-manager/connection/route";
import * as image from "@/app/api/organizations/[orgId]/ads-manager/image/route";
import * as campaigns from "@/app/api/organizations/[orgId]/ads-manager/campaigns/route";
import * as status from "@/app/api/organizations/[orgId]/ads-manager/campaigns/[adId]/status/route";
import * as sync from "@/app/api/organizations/[orgId]/ads-manager/campaigns/[adId]/sync/route";
import * as locations from "@/app/api/organizations/[orgId]/ads-manager/locations/route";
import * as syncAllRoute from "@/app/api/organizations/[orgId]/ads-manager/sync/route";
import * as previewRoute from "@/app/api/organizations/[orgId]/ads-manager/campaigns/[adId]/preview/route";

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
function graph(calls: Call[], opts: { failAt?: string; ad?: Record<string, unknown>; preview?: string; rejectStatus?: boolean; rejectWelcome?: boolean } = {}) {
  let seq = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v[\d.]+\//, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ path, method, body });
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (opts.rejectStatus && path.endsWith("/adsets") && JSON.stringify(body).includes("whatsapp_positions")) return reply({ error: { message: "Invalid parameter", code: 100, error_user_title: "Placement unavailable", error_user_msg: "WhatsApp Status isn't available for this ad account." } }, 400);
    if (opts.rejectWelcome && path.endsWith("/adcreatives") && JSON.stringify(body).includes("page_welcome_message")) return reply({ error: { message: "Invalid parameter", code: 100, error_user_title: "Welcome message unavailable", error_user_msg: "page_welcome_message is not supported here." } }, 400);
    if (opts.failAt && path.endsWith(opts.failAt) && method === "POST") return reply({ error: { message: "Invalid parameter", code: 100, error_subcode: 1870227, error_user_title: "Advantage audience flag required", error_user_msg: "Set targeting_automation.advantage_audience to 0 or 1." } }, 400);
    if (method === "GET" && /^act_\d+$/.test(path)) return reply({ id: path, name: "Shop Ads", currency: "INR", account_status: 1 });
    if (method === "GET" && path === "search") return reply({ data: [{ key: "1035921", name: "Ludhiana", type: "city", region: "Punjab" }, { key: "1748", name: "Punjab", type: "region" }, { key: "IN", name: "India", type: "country" }] });
    if (method === "GET" && /insights$/.test(path)) return reply({ data: [{ spend: "123.45", impressions: "5000", clicks: "210" }] });
    if (method === "GET" && path.endsWith("/previews")) return reply({ data: [{ body: opts.preview ?? '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=abc&amp;t=xyz" width="540" height="690"></iframe>' }] });
    if (method === "GET" && /^ads_\d+$/.test(path) && opts.ad) return reply({ id: path, ...opts.ad });
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
    // Fields Meta (v23+) requires: no budget sharing across ad sets, explicit Advantage+ audience choice.
    expect(posts[0].body).toMatchObject({ is_adset_budget_sharing_enabled: false, objective: "OUTCOME_ENGAGEMENT" });
    expect((posts[1].body as { targeting: { targeting_automation: { advantage_audience: number } } }).targeting.targeting_automation).toEqual({ advantage_audience: 0 });

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
    expect(String(r.body.error)).toBe("Meta: Creative: Invalid parameter — Advantage audience flag required: Set targeting_automation.advantage_audience to 0 or 1.");
    const row = await db.adCampaign.findFirstOrThrow({ where: { organizationId: t.org.id } });
    expect(row).toMatchObject({ status: "failed" });
    expect(row.lastError).toContain("Creative: Invalid parameter — Advantage audience flag required");
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

describe("location targeting", () => {
  it("finds states and cities on Meta and targets only them", async () => {
    const t = await tenant();
    const calls: Call[] = [];
    graph(calls);
    await connect(t);
    const found = await json(await locations.GET(req("/x?q=ludh"), P(t.org.id)));
    expect(found.status).toBe(200);
    expect(found.body.locations).toEqual([
      { key: "1035921", name: "Ludhiana", type: "city", region: "Punjab" },
      { key: "1748", name: "Punjab", type: "region", region: "" },
    ]);
    expect((await locations.GET(req("/x?q=l"), P(t.org.id))).status).toBe(400);

    const r = await json(await campaigns.POST(post(adBody(t, { locations: [{ key: "1035921", name: "Ludhiana", type: "city", radiusKm: 40 }, { key: "1748", name: "Punjab", type: "region" }] })), P(t.org.id)));
    expect(r.status).toBe(201);
    const adset = calls.find((c) => c.path.endsWith("/adsets"))!;
    expect((adset.body!.targeting as { geo_locations: unknown }).geo_locations).toEqual({ regions: [{ key: "1748" }], cities: [{ key: "1035921", radius: 40, distance_unit: "kilometer" }] });
    expect((r.body.ad as { locations: unknown[] }).locations).toHaveLength(2);
  });

  it("defaults to all of India and rejects bad places", async () => {
    const t = await tenant();
    const calls: Call[] = [];
    graph(calls);
    await connect(t);
    await campaigns.POST(post(adBody(t)), P(t.org.id));
    expect((calls.find((c) => c.path.endsWith("/adsets"))!.body!.targeting as { geo_locations: unknown }).geo_locations).toEqual({ countries: ["IN"] });
    expect((await campaigns.POST(post(adBody(t, { locations: [{ key: "1", name: "X", type: "city", radiusKm: 500 }] })), P(t.org.id))).status).toBe(400);
    expect((await campaigns.POST(post(adBody(t, { locations: [{ key: "bad key!", name: "X", type: "region" }] })), P(t.org.id))).status).toBe(400);
  });

  it("agents can't search places", async () => {
    const t = await tenant();
    graph([]);
    await connect(t);
    actAs(t.agent);
    expect((await locations.GET(req("/x?q=punjab"), P(t.org.id))).status).toBe(403);
  });

  it("syncs Meta's live status and review result: in review, then rejected with the reason", async () => {
    const t = await tenant();
    graph([], { ad: { effective_status: "PENDING_REVIEW" } });
    await connect(t);
    actAs(t.owner);
    const ad = (await json(await campaigns.POST(post(adBody(t)), P(t.org.id)))).body.ad as { id: string };
    await status.POST(post({ action: "activate", confirmBudget: true }), P(t.org.id, { adId: ad.id }));
    const all = await json(await syncAllRoute.POST(post({}), P(t.org.id)));
    expect(all.body).toMatchObject({ synced: 1, failed: 0 });
    const row = (all.body.overview as { campaigns: { id: string; status: string; metaStatus: string; spend: number }[] }).campaigns.find((c) => c.id === ad.id)!;
    expect(row).toMatchObject({ status: "active", metaStatus: "PENDING_REVIEW", spend: 12_345 });

    vi.restoreAllMocks();
    graph([], { ad: { effective_status: "DISAPPROVED", ad_review_feedback: { global: { LOW_QUALITY_OR_DISRUPTIVE_CONTENT: "Your ad wasn't approved because it uses misleading claims." } } } });
    const one = await json(await sync.POST(post({}), P(t.org.id, { adId: ad.id })));
    expect(one.body.ad).toMatchObject({ metaStatus: "DISAPPROVED" });
    expect((one.body.ad as { reviewNote: string }).reviewNote).toContain("misleading claims");

    // Paused on Meta (e.g. from Ads Manager) → MECGURA shows paused too.
    vi.restoreAllMocks();
    graph([], { ad: { effective_status: "CAMPAIGN_PAUSED" } });
    const p = await json(await sync.POST(post({}), P(t.org.id, { adId: ad.id })));
    expect(p.body.ad).toMatchObject({ status: "paused", metaStatus: "CAMPAIGN_PAUSED" });
  });

  it("previews: passes on only a facebook.com preview URL; agents can't see it", async () => {
    const t = await tenant();
    graph([]);
    await connect(t);
    actAs(t.owner);
    const ad = (await json(await campaigns.POST(post(adBody(t)), P(t.org.id)))).body.ad as { id: string };
    const r = await json(await previewRoute.GET(req("/x?format=INSTAGRAM_STORY"), P(t.org.id, { adId: ad.id })));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ url: "https://www.facebook.com/ads/api/preview_iframe.php?d=abc&t=xyz", format: "INSTAGRAM_STORY" });
    expect((await previewRoute.GET(req("/x?format=BOGUS"), P(t.org.id, { adId: ad.id }))).status).toBe(400);
    vi.restoreAllMocks();
    graph([], { preview: '<iframe src="https://evil.example.com/x"></iframe>' });
    expect((await previewRoute.GET(req("/x"), P(t.org.id, { adId: ad.id }))).status).toBe(409);
    actAs(t.agent);
    expect((await previewRoute.GET(req("/x"), P(t.org.id, { adId: ad.id }))).status).toBe(403);
  });

  it("sends the opening greeting and tappable questions with the creative, and still creates the ad if Meta refuses them", async () => {
    const t = await tenant();
    let calls: Call[] = [];
    graph(calls);
    await connect(t);
    actAs(t.owner);
    const r = await json(await campaigns.POST(post(adBody(t, { name: "Pest ad", greeting: "Hi! Please let us know how we can help you.", starters: ["What is the cost of termite control?", "Do you offer emergency service?"] })), P(t.org.id)));
    expect(r.status).toBe(201);
    const link = ((calls.find((c) => c.path.endsWith("/adcreatives"))!.body!.object_story_spec as Record<string, unknown>).link_data as Record<string, unknown>);
    const welcome = JSON.parse(String(link.page_welcome_message)) as { text_format: { customer_action_type: string; message: { text: string; ice_breakers: { title: string }[] } } };
    expect(welcome.text_format.customer_action_type).toBe("ice_breakers");
    expect(welcome.text_format.message.text).toBe("Hi! Please let us know how we can help you.");
    expect(welcome.text_format.message.ice_breakers.map((q) => q.title)).toEqual(["What is the cost of termite control?", "Do you offer emergency service?"]);
    expect(r.body.ad).toMatchObject({ greeting: "Hi! Please let us know how we can help you.", starters: ["What is the cost of termite control?", "Do you offer emergency service?"], greetingNote: "" });

    // No greeting or questions: nothing extra is sent.
    vi.restoreAllMocks();
    calls = [];
    graph(calls);
    await campaigns.POST(post(adBody(t, { name: "Plain ad" })), P(t.org.id));
    expect(JSON.stringify(calls.find((c) => c.path.endsWith("/adcreatives"))!.body)).not.toContain("page_welcome_message");

    // Meta refuses the greeting: the ad is still created, without it, with the reason shown.
    vi.restoreAllMocks();
    calls = [];
    graph(calls, { rejectWelcome: true });
    const fb = await json(await campaigns.POST(post(adBody(t, { name: "Fallback greeting", greeting: "Hello!", starters: ["Price?"] })), P(t.org.id)));
    expect(fb.status).toBe(201);
    const creatives = calls.filter((c) => c.path.endsWith("/adcreatives"));
    expect(creatives).toHaveLength(2);
    expect(JSON.stringify(creatives[1].body)).not.toContain("page_welcome_message");
    expect(fb.body.ad).toMatchObject({ status: "paused" });
    expect((fb.body.ad as { greetingNote: string }).greetingNote).toContain("not applied");

    // Too many questions or a long one is refused before anything goes to Meta.
    expect((await campaigns.POST(post(adBody(t, { name: "Too many", starters: ["a", "b", "c", "d"] })), P(t.org.id))).status).toBe(400);
    expect((await campaigns.POST(post(adBody(t, { name: "Too long", starters: ["x".repeat(81)] })), P(t.org.id))).status).toBe(400);
  });

  it("adds WhatsApp Status (with Instagram Stories) by default, and falls back to Facebook + Instagram when Meta refuses it", async () => {
    const t = await tenant();
    let calls: Call[] = [];
    graph(calls);
    await connect(t);
    actAs(t.owner);
    const r = await json(await campaigns.POST(post(adBody(t)), P(t.org.id)));
    expect(r.status).toBe(201);
    const targeting = calls.find((c) => c.path.endsWith("/adsets"))!.body!.targeting as Record<string, string[]>;
    expect(targeting.publisher_platforms).toEqual(["facebook", "instagram", "whatsapp"]);
    expect(targeting.whatsapp_positions).toEqual(["status"]);
    expect(targeting.instagram_positions).toContain("story");
    expect(r.body.ad).toMatchObject({ whatsappStatus: true, placementNote: "" });

    vi.restoreAllMocks();
    calls = [];
    graph(calls, { rejectStatus: true });
    const fb = await json(await campaigns.POST(post(adBody(t, { name: "Fallback ad" })), P(t.org.id)));
    expect(fb.status).toBe(201);
    const adsets = calls.filter((c) => c.path.endsWith("/adsets"));
    expect(adsets).toHaveLength(2);
    expect(JSON.stringify(adsets[1].body)).not.toContain("whatsapp_positions");
    expect(fb.body.ad).toMatchObject({ whatsappStatus: false, status: "paused" });
    expect((fb.body.ad as { placementNote: string }).placementNote).toContain("WhatsApp Status isn't available");

    // Unticked: no WhatsApp placement asked for at all (automatic Facebook + Instagram placements).
    vi.restoreAllMocks();
    calls = [];
    graph(calls);
    await campaigns.POST(post(adBody(t, { name: "FB only", whatsappStatus: false })), P(t.org.id));
    expect(JSON.stringify(calls.find((c) => c.path.endsWith("/adsets"))!.body)).not.toContain("publisher_platforms");
  });
});
