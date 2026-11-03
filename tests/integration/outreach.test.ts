import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, json, makeUser, params, req } from "../helpers";
import * as overviewRoute from "@/app/api/admin/outreach/route";
import * as searchRoute from "@/app/api/admin/outreach/search/route";
import * as emailsRoute from "@/app/api/admin/outreach/emails/route";
import * as addRoute from "@/app/api/admin/outreach/add/route";
import * as settingsRoute from "@/app/api/admin/outreach/settings/route";
import * as emailRoute from "@/app/api/admin/outreach/email/route";
import * as contactedRoute from "@/app/api/admin/marketing/leads/[id]/contacted/route";
import * as unsubRoute from "@/app/api/m/unsubscribe/route";
import { DEFAULT_SETTINGS, extractEmails, findEmails, unsubscribeToken } from "@/services/marketing/outreach";

const realFetch = globalThis.fetch;
afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
  delete process.env.GOOGLE_MAPS_API_KEY;
});

let n = 0;
const phone = () => `+9197${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;
const post = (body: unknown) => req("/x", { method: "POST", body });
const put = (body: unknown) => req("/x", { method: "PUT", body });

async function admin() {
  const a = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
  actAs(a);
  return a;
}

describe("outreach", () => {
  it("only the Super Admin can use outreach", async () => {
    actAs(await makeUser({ name: "Client" }));
    expect((await overviewRoute.GET(req("/x"))).status).toBe(403);
    expect((await searchRoute.POST(post({ category: "Salon", city: "Ludhiana" }))).status).toBe(403);
    expect((await addRoute.POST(post({ prospects: [] }))).status).toBe(403);
    expect((await emailRoute.POST(post({ leadIds: ["x"] }))).status).toBe(403);
    expect((await settingsRoute.PUT(put(DEFAULT_SETTINGS))).status).toBe(403);
  });

  it("Maps search says it's not set up without a key, then returns businesses and marks ones already in Leads", async () => {
    await admin();
    const off = await json(await searchRoute.POST(post({ category: "Salon", city: "Ludhiana" })));
    expect(off.status).toBe(409);
    expect(String(off.body.error)).toContain("GOOGLE_MAPS_API_KEY");
    expect((await searchRoute.POST(post({ city: "Ludhiana" }))).status).toBe(400);

    const known = phone();
    await db.marketingLead.create({ data: { phone: known, business: "Known Salon", source: "maps" } });
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    const spy = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ textQuery: "Salon in Ludhiana", regionCode: "IN" });
      expect((init?.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("test-key");
      return new Response(
        JSON.stringify({
          places: [
            { id: "p1", displayName: { text: "Glow Salon" }, internationalPhoneNumber: "+91 98765 43210", websiteUri: "https://glow.example", rating: 4.6, userRatingCount: 120, businessStatus: "OPERATIONAL" },
            { id: "p2", displayName: { text: "Known Salon" }, internationalPhoneNumber: known, businessStatus: "CLOSED_PERMANENTLY" },
          ],
          nextPageToken: "next-1",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await json(await searchRoute.POST(post({ category: "Salon", city: "Ludhiana" })));
    expect(r.status).toBe(200);
    const results = r.body.results as { name: string; phone: string; alreadyLead: boolean; open: boolean; rating: number | null }[];
    expect(results[0]).toMatchObject({ name: "Glow Salon", phone: "+919876543210", alreadyLead: false, open: true, rating: 4.6 });
    expect(results[1]).toMatchObject({ alreadyLead: true, open: false });
    expect(r.body.nextPageToken).toBe("next-1");
    // Search results are not stored.
    expect(await db.marketingLead.count({ where: { business: "Glow Salon" } })).toBe(0);
  });

  it("finds public emails on a website and never calls internal addresses", async () => {
    expect(extractEmails('<a href="mailto:Info@GlowSalon.in">x</a> hello&#64;glowsalon.in logo@2x.png noreply@glowsalon.in')).toEqual(["info@glowsalon.in", "hello@glowsalon.in"]);
    for (const bad of ["http://localhost:3000", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest", "file:///etc/passwd", "http://user:pw@8.8.8.8/"]) {
      await expect(findEmails(bad)).rejects.toThrow();
    }
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      const html = String(url).includes("contact") ? "<p>Write to bookings@shop.example.org</p>" : '<a href="/contact-us">Contact</a>';
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    expect(await findEmails("https://93.184.215.14/")).toEqual(["bookings@shop.example.org"]);
    expect(calls).toEqual(["https://93.184.215.14/", "https://93.184.215.14/contact-us"]);

    await admin();
    expect((await emailsRoute.POST(post({ website: "not a url" }))).status).toBe(400);
  });

  it("adds chosen results to Leads once, skips ones without a number, and keeps to the daily WhatsApp limit", async () => {
    await admin();
    const p1 = phone();
    const p2 = phone();
    const add = (prospects: unknown[]) => addRoute.POST(post({ city: "Amritsar", prospects }));
    const a = await json(await add([
      { placeId: "pa", name: "Amritsar Gym", phone: p1, category: "Gym", rating: 4.2, reviews: 30 },
      { placeId: "pb", name: "Fit Zone", phone: p2, email: "fit@zone.example", category: "Gym" },
      { placeId: "pc", name: "No Number", phone: "" },
    ]));
    expect(a.body).toMatchObject({ added: 2, existing: 0, skipped: ["No Number"] });
    expect((await json(await add([{ placeId: "pa", name: "Amritsar Gym", phone: p1 }]))).body).toMatchObject({ added: 0, existing: 1 });
    const l1 = await db.marketingLead.findUniqueOrThrow({ where: { phone: p1 } });
    expect(l1).toMatchObject({ source: "maps", campaign: "Gym", city: "Amritsar", placeId: "pa", stage: "new" });

    const o = await json(await overviewRoute.GET(req("/x")));
    expect((o.body.queue as { id: string }[]).some((q) => q.id === l1.id)).toBe(true);
    expect(o.body.mapsReady).toBe(false);

    // First message goes through; then the limit is set to what's been used today and the next lead is held back.
    expect((await contactedRoute.POST(post({}), params({ id: l1.id }))).status).toBe(200);
    const used = (await json(await overviewRoute.GET(req("/x")))).body.whatsappToday as number;
    expect(used).toBeGreaterThan(0);
    expect((await settingsRoute.PUT(put({ ...DEFAULT_SETTINGS, dailyWhatsApp: Math.min(100, used) }))).status).toBe(200);
    const l2 = await db.marketingLead.findUniqueOrThrow({ where: { phone: p2 } });
    if (used <= 100) expect((await contactedRoute.POST(post({}), params({ id: l2.id }))).status).toBe(429);
    // Following up a lead already contacted isn't limited.
    expect((await contactedRoute.POST(post({}), params({ id: l1.id }))).status).toBe(200);
    expect((await settingsRoute.PUT(put({ ...DEFAULT_SETTINGS, dailyWhatsApp: 0 }))).status).toBe(400);
    await settingsRoute.PUT(put(DEFAULT_SETTINGS));
  });

  it("emails leads with sender details and an unsubscribe link, once a week at most, and honours unsubscribe", async () => {
    await admin();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const a = await db.marketingLead.create({ data: { phone: phone(), name: "Harpreet", business: "Harpreet Bakery", city: "Jalandhar", campaign: "Bakery", email: `h${n}@bakery.example`, source: "maps" } });
    const b = await db.marketingLead.create({ data: { phone: phone(), business: "Old Lead", email: `o${n}@x.example`, source: "maps", stage: "lost" } });
    const c = await db.marketingLead.create({ data: { phone: phone(), business: "No Email", source: "maps" } });

    const r = await json(await emailRoute.POST(post({ leadIds: [a.id, b.id, c.id] })));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sent: 1, failed: 0, skipped: 2 });
    const mail = info.mock.calls.map((x) => String(x[0])).find((t) => t.includes(a.email)) ?? "";
    expect(mail).toContain("Subject: Quick idea for Harpreet Bakery's WhatsApp");
    expect(mail).toContain("bakery owners in Jalandhar");
    expect(mail).toContain(DEFAULT_SETTINGS.senderDetails);
    expect(mail).toContain(`/api/m/unsubscribe?l=${a.id}&t=${unsubscribeToken(a.id)}`);
    const after = await db.marketingLead.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.stage).toBe("contacted");
    expect(after.lastEmailedAt).not.toBeNull();

    // Not again within a week.
    expect((await json(await emailRoute.POST(post({ leadIds: [a.id] })))).body).toMatchObject({ sent: 0, skipped: 1 });

    // Unsubscribe: a wrong token is refused, the right one opts out, and opted-out leads are never emailed.
    const unsub = (l: string, t: string) => unsubRoute.GET(new Request(`http://localhost:3000/api/m/unsubscribe?l=${l}&t=${t}`, { headers: { "x-forwarded-for": "198.51.100.9" } }));
    expect((await unsub(a.id, "wrong")).status).toBe(400);
    const ok = await unsub(a.id, unsubscribeToken(a.id));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("unsubscribed");
    await db.marketingLead.update({ where: { id: a.id }, data: { lastEmailedAt: null } });
    expect((await json(await emailRoute.POST(post({ leadIds: [a.id] })))).body).toMatchObject({ sent: 0, skipped: 1 });
    expect((await db.marketingLead.findUniqueOrThrow({ where: { id: a.id } })).emailOptOut).toBe(true);
  });

  it("the daily email limit stops a batch", async () => {
    await admin();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const x = await db.marketingLead.create({ data: { phone: phone(), business: "Limit Test", email: `l${n}@x.example`, source: "maps" } });
    const used = (await json(await overviewRoute.GET(req("/x")))).body.emailToday as number;
    if (used >= 1 && used <= 300) {
      await settingsRoute.PUT(put({ ...DEFAULT_SETTINGS, dailyEmail: used }));
      expect((await emailRoute.POST(post({ leadIds: [x.id] }))).status).toBe(429);
      await settingsRoute.PUT(put(DEFAULT_SETTINGS));
    }
  });
});
