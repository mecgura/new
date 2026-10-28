import { beforeAll, describe, expect, it } from "vitest";
import { actAs, json, makeUser, req } from "../helpers";
import * as route from "@/app/api/admin/festivals/route";
import * as photoRoute from "@/app/api/admin/festivals/photo/route";
import * as publicPhoto from "@/app/api/festival-photo/[id]/route";
import { setSetting } from "@/lib/settings";
import { activeFestival, DEFAULT_FESTIVALS, festivalPromo, festivePrice, getFestivals, offerText, themeFor, upcomingFestivals, type Festival } from "@/services/site/festivals";

let admin: Awaited<ReturnType<typeof makeUser>>;
let other: Awaited<ReturnType<typeof makeUser>>;
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const fest = (over: Partial<Festival> = {}): Festival => ({ id: "diwali-t", name: "Diwali", emoji: "🪔", start: "2026-11-07", days: 3, greeting: "Happy Diwali", offer: "Free setup", offerCode: "DIWALI26", effect: "fireworks", showOnSite: true, showToClients: true, hasPhoto: false, leadDays: 3, discountPercent: 10, applyToPlans: true, theme: "auto", ...over });

beforeAll(async () => {
  admin = await makeUser({ role: "SUPER_ADMIN", name: "Fest Admin" });
  other = await makeUser({ name: "Client person" });
});

describe("festival calendar", () => {
  it("knows which festival is on and what comes next (IST dates, multi-day)", () => {
    const s = { enabled: true, festivals: [fest(), fest({ id: "gurpurab-t", name: "Gurpurab", start: "2026-11-24", days: 1, showToClients: false })] };
    expect(activeFestival(s, "site", "2026-11-06")).toBeNull();
    expect(activeFestival(s, "site", "2026-11-07")?.name).toBe("Diwali");
    expect(activeFestival(s, "site", "2026-11-09")?.name).toBe("Diwali");
    expect(activeFestival(s, "site", "2026-11-10")).toBeNull();
    expect(activeFestival(s, "clients", "2026-11-24")).toBeNull();
    expect(activeFestival({ ...s, enabled: false }, "site", "2026-11-08")).toBeNull();
    const up = upcomingFestivals(s, "2026-11-01");
    expect(up.map((x) => [x.name, x.inDays])).toEqual([["Diwali", 6], ["Gurpurab", 23]]);
  });

  it("ships a starting list and only lets the Super Admin change it", async () => {
    await setSetting("festivals", ""); // other test files share the database
    expect((await getFestivals()).festivals.length).toBe(DEFAULT_FESTIVALS.festivals.length);
    actAs(other);
    expect((await route.GET(req("/api/admin/festivals"))).status).toBe(403);
    expect((await route.PUT(req("/api/admin/festivals", { method: "PUT", body: { enabled: true, festivals: [] } }))).status).toBe(403);
    expect((await photoRoute.PUT(req("/api/admin/festivals/photo", { method: "PUT", body: { id: "x", photo: PHOTO } }))).status).toBe(403);
  });

  it("saves festivals and photos; the photo is served publicly", async () => {
    actAs(admin);
    const saved = await json(await route.PUT(req("/api/admin/festivals", { method: "PUT", body: { enabled: true, festivals: [fest()] } })));
    expect(saved.status).toBe(200);
    expect((await photoRoute.PUT(req("/api/admin/festivals/photo", { method: "PUT", body: { id: "diwali-t", photo: PHOTO } }))).status).toBe(200);
    expect((await getFestivals()).festivals[0].hasPhoto).toBe(true);
    const img = await publicPhoto.GET(req("/api/festival-photo/diwali-t"), { params: Promise.resolve({ id: "diwali-t" }) });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    expect((await publicPhoto.GET(req("/api/festival-photo/nope"), { params: Promise.resolve({ id: "../etc" }) })).status).toBe(404);
  });

  it("rejects bad dates, effects and non-image photos", async () => {
    actAs(admin);
    const put = (f: unknown) => route.PUT(req("/api/admin/festivals", { method: "PUT", body: { enabled: true, festivals: [f] } }));
    expect((await put({ ...fest(), start: "8 Nov" })).status).toBe(400);
    expect((await put({ ...fest(), effect: "explode" })).status).toBe(400);
    expect((await put({ ...fest(), days: 99 })).status).toBe(400);
    expect((await photoRoute.PUT(req("/api/admin/festivals/photo", { method: "PUT", body: { id: "diwali-t", photo: "data:image/svg+xml;base64,PHN2Zz4=" } }))).status).toBe(400);
  });
});

describe("festival offers on the website", () => {
  const s = { enabled: true, festivals: [fest({ offer: "", discountPercent: 20, leadDays: 3 }), fest({ id: "xmas", name: "Christmas", emoji: "🎄", start: "2026-12-24", days: 2, effect: "snow", offer: "", discountPercent: 0 })] };

  it("starts advertising a few days early, then runs through the festival, then stops", () => {
    expect(festivalPromo(s, "2026-11-03")).toBeNull();
    const pre = festivalPromo(s, "2026-11-04")!;
    expect(pre).toMatchObject({ phase: "pre", daysToStart: 3, offer: "20% off on all MECGURA plans", theme: "gold" });
    expect(festivalPromo(s, "2026-11-06")!.phase).toBe("pre");
    expect(festivalPromo(s, "2026-11-07")!).toMatchObject({ phase: "live", endsOn: "2026-11-09" });
    expect(festivalPromo(s, "2026-11-10")).toBeNull();
    expect(festivalPromo({ ...s, enabled: false }, "2026-11-05")).toBeNull();
    expect(festivalPromo({ enabled: true, festivals: [fest({ leadDays: 0 })] }, "2026-11-05")).toBeNull();
    expect(festivalPromo({ enabled: true, festivals: [fest({ showOnSite: false })] }, "2026-11-05")).toBeNull();
  });

  it("works out the theme, offer text and festive price", () => {
    expect(themeFor(fest({ id: "xmas", name: "Christmas", effect: "snow" }))).toBe("winter");
    expect(themeFor(fest({ theme: "holi" }))).toBe("holi");
    expect(themeFor(fest({ id: "custom", name: "Store anniversary", effect: "confetti" }))).toBe("saffron");
    expect(offerText(fest({ offer: "Free setup", discountPercent: 20 }))).toBe("Free setup");
    expect(offerText(fest({ offer: "", discountPercent: 0 }))).toBe("");
    expect(festivePrice(299900, 20)).toBe(239900);
    expect(festivePrice(99900, 15)).toBe(84900);
  });

  it("older saved calendars get the new fields with sensible defaults", async () => {
    const old = { enabled: true, festivals: [{ id: "diwali-t", name: "Diwali", emoji: "🪔", start: "2026-11-07", days: 3, greeting: "", offer: "", offerCode: "", effect: "fireworks", showOnSite: true, showToClients: true, hasPhoto: false }] };
    await setSetting("festivals", JSON.stringify(old));
    const got = (await getFestivals()).festivals[0];
    expect(got).toMatchObject({ leadDays: 3, discountPercent: 10, applyToPlans: true, theme: "auto" });
    await setSetting("festivals", "");
  });
});
