import { beforeAll, describe, expect, it } from "vitest";
import { actAs, json, makeUser, req } from "../helpers";
import * as route from "@/app/api/admin/festivals/route";
import * as photoRoute from "@/app/api/admin/festivals/photo/route";
import * as publicPhoto from "@/app/api/festival-photo/[id]/route";
import { activeFestival, DEFAULT_FESTIVALS, getFestivals, upcomingFestivals, type Festival } from "@/services/site/festivals";

let admin: Awaited<ReturnType<typeof makeUser>>;
let other: Awaited<ReturnType<typeof makeUser>>;
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const fest = (over: Partial<Festival> = {}): Festival => ({ id: "diwali-t", name: "Diwali", emoji: "🪔", start: "2026-11-07", days: 3, greeting: "Happy Diwali", offer: "Free setup", offerCode: "DIWALI26", effect: "fireworks", showOnSite: true, showToClients: true, hasPhoto: false, ...over });

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
