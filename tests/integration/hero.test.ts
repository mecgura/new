import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { db } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { actAs, json, makeUser, req } from "../helpers";
import * as heroRoute from "@/app/api/admin/site-hero/route";
import * as photoRoute from "@/app/api/admin/site-hero/photo/route";
import * as publicPhoto from "@/app/api/site/hero/[slide]/route";
import { getHero, SLIDE_IDS } from "@/services/site/hero";

const put = (body: unknown) => req("/x", { method: "PUT", body });
const pub = (slide: string) => publicPhoto.GET(new Request(`http://localhost:3000/api/site/hero/${slide}`), { params: Promise.resolve({ slide }) });
const text = (over: Record<string, unknown> = {}) => Object.fromEntries(SLIDE_IDS.map((id) => [id, { headline: `Headline for ${id}`, description: `A description for the ${id} slide.`, enabled: true, ...over }]));

describe("home page hero", () => {
  it("six industry slides with their own chat, editable only by the Super Admin", async () => {
    await setSetting("home:hero", "{}");
    const slides = await getHero();
    expect(slides.map((s) => s.id)).toEqual(["retail", "salon", "food", "education", "healthcare", "realestate"]);
    expect(slides[1]).toMatchObject({ headline: "WhatsApp that books for your salon.", photoUrl: null, enabled: true });
    expect(slides.every((s) => s.chat.length === 4)).toBe(true);

    actAs(await makeUser({ name: "Client" }));
    expect((await heroRoute.PUT(put({ slides: text() }))).status).toBe(403);
    expect((await photoRoute.PUT(put({ slide: "salon" }))).status).toBe(403);

    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const r = await json(await heroRoute.PUT(put({ slides: { ...text(), salon: { headline: "Your salon, fully booked.", description: "Bookings and reminders on WhatsApp.", enabled: false } } })));
    expect(r.status).toBe(200);
    expect((r.body.slides as { id: string; headline: string; enabled: boolean }[]).find((s) => s.id === "salon")).toMatchObject({ headline: "Your salon, fully booked.", enabled: false });
    expect((await heroRoute.PUT(put({ slides: text({ enabled: false }) }))).status).toBe(400);
    expect((await heroRoute.PUT(put({ slides: { salon: { headline: "x", description: "y", enabled: true } } }))).status).toBe(400);
  });

  it("an uploaded or AI studio photo is resized to WebP and served publicly only while a slide uses it", async () => {
    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const png = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 15, g: 81, b: 50 } } }).png().toBuffer();
    const r = await json(await photoRoute.PUT(put({ slide: "retail", upload: `data:image/png;base64,${png.toString("base64")}` })));
    expect(r.status).toBe(200);
    const url = (r.body.slides as { id: string; photoUrl: string }[]).find((s) => s.id === "retail")!.photoUrl;
    expect(url).toMatch(/^\/api\/site\/hero\/retail\?v=/);
    const res = await pub("retail");
    expect(res.headers.get("content-type")).toBe("image/webp");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([900, 1125, "webp"]);
    const firstId = url.split("v=")[1];

    // From the AI gallery: a fresh copy is made and the old hero photo is deleted.
    const ai = await db.marketingImage.create({ data: { provider: "gemini", prompt: "Shop owner", data: new Uint8Array(png) } });
    const r2 = await json(await photoRoute.PUT(put({ slide: "retail", imageId: ai.id })));
    expect(r2.status).toBe(200);
    expect(await db.marketingImage.count({ where: { id: firstId } })).toBe(0);
    expect(await db.marketingImage.count({ where: { id: ai.id } })).toBe(1);

    // Junk, unknown slides and gallery images are never served.
    expect((await photoRoute.PUT(put({ slide: "retail", upload: "data:image/png;base64,bm90IGFuIGltYWdl" }))).status).toBe(400);
    expect((await pub("nope")).status).toBe(404);
    expect((await pub("salon")).status).toBe(404);

    // Removing it.
    const r3 = await json(await photoRoute.PUT(put({ slide: "retail" })));
    expect((r3.body.slides as { id: string; photoUrl: string | null }[]).find((s) => s.id === "retail")!.photoUrl).toBeNull();
    expect((await pub("retail")).status).toBe(404);
    await setSetting("home:hero", "{}");
  });
});
