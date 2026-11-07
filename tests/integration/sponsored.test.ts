import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as listRoute from "@/app/api/organizations/[orgId]/sponsored/route";
import * as oneRoute from "@/app/api/organizations/[orgId]/sponsored/[id]/route";
import * as actionRoute from "@/app/api/organizations/[orgId]/sponsored/[id]/action/route";
import * as adminList from "@/app/api/admin/sponsored/route";
import * as adminOne from "@/app/api/admin/sponsored/[id]/route";
import * as adminSettings from "@/app/api/admin/sponsored/settings/route";
import * as serveRoute from "@/app/api/sponsored/serve/route";
import * as clickRoute from "@/app/api/sponsored/[id]/click/route";
import * as imgRoute from "@/app/api/sponsored-img/[key]/route";
import { hasLiveAds, normalizeLink, phaseOf } from "@/services/sponsored/sponsored";
import { resetRateLimits } from "@/lib/rate-limit";

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 7)]);
const png = `data:image/png;base64,${PNG.toString("base64")}`;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });
const put = (body: unknown) => req("/x", { method: "PUT", body });
const AD = { name: "Diwali offer", headline: "Flat 20% off on bridal makeup", body: "Book this week at Glow Studio.", ctaLabel: "Book now", linkType: "url", link: "https://glowstudio.example.com/offer", waMessage: "", startsAt: "", endsAt: "" };
const visitor = (ip = "203.0.113.5", ua = "Mozilla/5.0 (iPhone)") => ({ headers: { "x-forwarded-for": ip, "user-agent": ua } });

let orgId = "";
let otherOrg = "";
let owner: Awaited<ReturnType<typeof makeUser>>;
let agent: Awaited<ReturnType<typeof makeUser>>;
let otherOwner: Awaited<ReturnType<typeof makeUser>>;
let admin: Awaited<ReturnType<typeof makeUser>>;

async function workspace(name: string, service: boolean) {
  const org = (await makeOrg(name)).id;
  const o = await makeUser({ name: `${name} Owner` });
  await addMember(org, o.id, "CLIENT_OWNER");
  const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: org, planId: plan.id, priceMonthly: plan.priceMonthly } });
  if (service) await db.organizationService.create({ data: { organizationId: org, service: "SPONSORED_ADS", enabled: true } });
  return { org, owner: o };
}

beforeAll(async () => {
  const a = await workspace("Glow Studio", true);
  orgId = a.org;
  owner = a.owner;
  const b = await workspace("No Service Shop", false);
  otherOrg = b.org;
  otherOwner = b.owner;
  agent = await makeUser({ name: "Agent" });
  await addMember(orgId, agent.id, "AGENT");
  admin = await makeUser({ name: "Admin", role: "SUPER_ADMIN" });
});

describe("Sponsored placements", () => {
  it("link rules: https only, no IPs / localhost / credentials, valid WhatsApp numbers", () => {
    expect(normalizeLink("url", "https://example.com/x")).toBe("https://example.com/x");
    for (const bad of ["http://example.com", "javascript:alert(1)", "https://localhost/x", "https://127.0.0.1/x", "https://user:pw@example.com", "not a url", "https://intranet"]) expect(() => normalizeLink("url", bad), bad).toThrow();
    expect(normalizeLink("whatsapp", "98765 43210")).toBe("919876543210");
    expect(() => normalizeLink("whatsapp", "12")).toThrow();
  });

  it("is closed to workspaces without the service and to agents; owner can build", async () => {
    actAs(otherOwner);
    expect((await listRoute.GET(req("/x"), P(otherOrg))).status).toBe(403);
    expect((await listRoute.POST(post(AD), P(otherOrg))).status).toBe(403);
    actAs(agent);
    expect((await listRoute.GET(req("/x"), P(orgId))).status).toBe(200);
    expect((await listRoute.POST(post(AD), P(orgId))).status).toBe(403);
  });

  it("nothing is shown until the client submits and MECGURA approves", async () => {
    resetRateLimits();
    actAs(owner);
    const bad = await listRoute.POST(post({ ...AD, link: "http://insecure.example.com" }), P(orgId));
    expect(bad.status).toBe(400);
    const c = await json(await listRoute.POST(post({ ...AD, image: png }), P(orgId)));
    expect(c.status).toBe(201);
    const ad = c.body.ad as { id: string; status: string; imageUrl: string };
    expect(ad.status).toBe("draft");
    expect(await hasLiveAds()).toBe(false);

    // Draft and pending ads are never served or clickable.
    expect((await json(await serveRoute.GET(new Request("http://x/api/sponsored/serve", visitor())))).body.ads).toEqual([]);
    expect((await clickRoute.GET(new Request("http://x", visitor()), { params: Promise.resolve({ id: ad.id }) })).headers.get("location")).toMatch(/\/blog$/);

    expect((await json(await actionRoute.POST(post({ action: "submit" }), P(orgId, { id: ad.id })))).body.ad).toMatchObject({ status: "pending", phase: "pending" });
    expect(await hasLiveAds()).toBe(false);

    // Admin approves with a view cap of 3.
    actAs(admin);
    expect((await json(await adminList.GET(req("/api/admin/sponsored?status=pending")))).body.counts).toMatchObject({ pending: 1 });
    const rej = await adminOne.POST(post({ action: "reject", note: "" }), params({ id: ad.id }));
    expect(rej.status).toBe(400);
    const ok = await json(await adminOne.POST(post({ action: "approve", maxImpressions: 3 }), params({ id: ad.id })));
    expect(ok.status).toBe(200);
    expect((ok.body.ad as { phase: string }).phase).toBe("live");
    expect(await hasLiveAds()).toBe(true);

    // The website: the card is served with the Sponsored label data, views are counted, bots are not.
    const first = await json(await serveRoute.GET(new Request("http://x/api/sponsored/serve", visitor("203.0.113.9"))));
    expect(first.body.ads).toEqual([expect.objectContaining({ id: ad.id, headline: AD.headline, advertiser: "Glow Studio", href: `/api/sponsored/${ad.id}/click` })]);
    await serveRoute.GET(new Request("http://x/api/sponsored/serve", visitor("203.0.113.10", "Googlebot/2.1")));
    expect((await db.sponsoredAd.findUniqueOrThrow({ where: { id: ad.id } })).impressions).toBe(1);

    // Image is public by its random key.
    const key = ad.imageUrl.split("/").pop()!.split("?")[0];
    const img = await imgRoute.GET(new Request("http://x"), { params: Promise.resolve({ key }) });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");

    // Click: counted once per visitor, redirects to the advertiser.
    const c1 = await clickRoute.GET(new Request("http://x", visitor("203.0.113.9")), { params: Promise.resolve({ id: ad.id }) });
    expect(c1.status).toBe(302);
    expect(c1.headers.get("location")).toBe("https://glowstudio.example.com/offer");
    await clickRoute.GET(new Request("http://x", visitor("203.0.113.9")), { params: Promise.resolve({ id: ad.id }) });
    expect((await db.sponsoredAd.findUniqueOrThrow({ where: { id: ad.id } })).clicks).toBe(1);

    // The cap ends it: after 3 views it stops being served.
    for (let i = 0; i < 4; i++) await serveRoute.GET(new Request("http://x/api/sponsored/serve", visitor(`198.51.100.${i}`)));
    const done = await db.sponsoredAd.findUniqueOrThrow({ where: { id: ad.id } });
    expect(done).toMatchObject({ impressions: 3, status: "ended" });
    expect(phaseOf(done)).toBe("ended");
    expect(await hasLiveAds()).toBe(false);
    expect((await json(await serveRoute.GET(new Request("http://x/api/sponsored/serve", visitor("198.51.100.99"))))).body.ads).toEqual([]);

    // The client sees its numbers and its daily report.
    actAs(owner);
    const mine = await json(await listRoute.GET(req("/x"), P(orgId)));
    expect((mine.body.ads as { impressions: number; clicks: number; ctr: number }[])[0]).toMatchObject({ impressions: 3, clicks: 1, ctr: 33.3 });
  });

  it("editing a live ad's words sends it back to review; a rejected ad can be fixed and resubmitted", async () => {
    resetRateLimits();
    actAs(owner);
    const ad = ((await json(await listRoute.POST(post({ ...AD, name: "Second", headline: "Free hair spa with any facial" }), P(orgId)))).body.ad as { id: string });
    await actionRoute.POST(post({ action: "submit" }), P(orgId, { id: ad.id }));
    actAs(admin);
    await adminOne.POST(post({ action: "approve" }), params({ id: ad.id }));
    actAs(owner);
    const edited = await json(await oneRoute.PUT(put({ ...AD, name: "Second", headline: "Free hair spa with any facial today" }), P(orgId, { id: ad.id })));
    expect(edited.body.ad).toMatchObject({ status: "pending" });
    expect(await hasLiveAds()).toBe(false);
    actAs(admin);
    expect((await json(await adminOne.POST(post({ action: "reject", note: "Please remove the 'today' claim" }), params({ id: ad.id })))).body.ad).toMatchObject({ status: "rejected", reviewNote: "Please remove the 'today' claim" });
    actAs(owner);
    expect((await json(await oneRoute.PUT(put({ ...AD, name: "Second", headline: "Free hair spa with any facial" }), P(orgId, { id: ad.id })))).body.ad).toMatchObject({ status: "draft", reviewNote: "" });
    expect((await json(await actionRoute.POST(post({ action: "submit" }), P(orgId, { id: ad.id })))).body.ad).toMatchObject({ status: "pending" });
  });

  it("a MECGURA pause can't be undone by the client; the master switch hides everything; tenants are isolated", async () => {
    resetRateLimits();
    actAs(owner);
    const ad = ((await json(await listRoute.POST(post({ ...AD, name: "Third", headline: "Weekend skin check-up offer" }), P(orgId)))).body.ad as { id: string });
    await actionRoute.POST(post({ action: "submit" }), P(orgId, { id: ad.id }));
    actAs(admin);
    await adminOne.POST(post({ action: "approve", startsAt: "2020-01-01" }), params({ id: ad.id }));
    expect(await hasLiveAds()).toBe(true);
    await adminSettings.PUT(req("/x", { method: "PUT", body: { enabled: false } }));
    expect(await hasLiveAds()).toBe(false);
    expect((await json(await serveRoute.GET(new Request("http://x/api/sponsored/serve", visitor("192.0.2.1"))))).body.ads).toEqual([]);
    await adminSettings.PUT(req("/x", { method: "PUT", body: { enabled: true } }));
    await adminOne.POST(post({ action: "pause", note: "Complaint received" }), params({ id: ad.id }));
    actAs(owner);
    expect((await actionRoute.POST(post({ action: "resume" }), P(orgId, { id: ad.id }))).status).toBe(409);
    actAs(otherOwner);
    expect((await oneRoute.DELETE(req("/x", { method: "DELETE" }), P(orgId, { id: ad.id }))).status).toBeGreaterThanOrEqual(403);
    expect(await db.sponsoredAd.count({ where: { id: ad.id } })).toBe(1);
    actAs(owner);
    expect((await oneRoute.DELETE(req("/x", { method: "DELETE" }), P(orgId, { id: ad.id }))).status).toBe(200);
  });

  it("only Super Admin can review", async () => {
    actAs(owner);
    expect((await adminList.GET(req("/api/admin/sponsored"))).status).toBeGreaterThanOrEqual(401);
  });
});
