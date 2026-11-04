import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import * as pagesRoute from "@/app/api/organizations/[orgId]/pages/route";
import * as pageRoute from "@/app/api/organizations/[orgId]/pages/[id]/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/pages/[id]/publish/route";
import * as duplicateRoute from "@/app/api/organizations/[orgId]/pages/[id]/duplicate/route";
import * as analyticsRoute from "@/app/api/organizations/[orgId]/pages/[id]/analytics/route";
import * as qrRoute from "@/app/api/organizations/[orgId]/pages/[id]/qr/route";
import * as imagesRoute from "@/app/api/organizations/[orgId]/pages/images/route";
import * as imageRoute from "@/app/api/lp-image/[id]/route";
import * as eventRoute from "@/app/api/lp/[id]/event/route";
import * as submitRoute from "@/app/api/lp/[id]/submit/route";
import { publicPage } from "@/services/landing/pages";
import { youtubeId, type Block } from "@/lib/landing";

type U = Awaited<ReturnType<typeof makeUser>>;
let orgId: string;
let orgSlug: string;
let owner: U, agent: U;
let pageId: string;
let ip = 0;
const P = () => params({ orgId });
const PI = (id: string) => params({ orgId, id });
const post = (b: unknown) => req("/x", { method: "POST", body: b });
const patch = (b: unknown) => req("/x", { method: "PATCH", body: b });
const pub = (url: string, body: unknown) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ip++ % 250}` }, body: typeof body === "string" ? body : JSON.stringify(body) });
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeAll(async () => {
  const org = await makeOrg("Glow Studio");
  orgId = org.id;
  orgSlug = org.slug;
  [owner, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  await db.whatsAppAccount.create({ data: { organizationId: orgId, displayName: "Glow", phoneNumber: "+919800055566", status: "demo", isDemo: true } });
});

describe("landing pages", () => {
  it("is locked until enabled; a page starts from an industry template with the WhatsApp number filled in", async () => {
    actAs(owner);
    expect((await pagesRoute.GET(req("/x"), P())).status).toBe(403);
    await db.organizationService.create({ data: { organizationId: orgId, service: "LANDING_PAGES", enabled: true } });
    const list = await json(await pagesRoute.GET(req("/x"), P()));
    expect((list.body.starters as { id: string }[]).map((s) => s.id)).toEqual(expect.arrayContaining(["salon", "clinic", "realestate", "coaching", "restaurant"]));
    actAs(agent);
    expect((await pagesRoute.POST(post({ title: "X" }), P())).status).toBe(403);
    actAs(owner);
    const c = await json(await pagesRoute.POST(post({ title: "Bridal Offer 2026!", starter: "salon" }), P()));
    expect(c.status).toBe(201);
    const page = c.body.page as { id: string; slug: string; status: string; blocks: Block[]; theme: { whatsapp: string; accent: string }; url: string };
    pageId = page.id;
    expect(page).toMatchObject({ slug: "bridal-offer-2026", status: "draft", theme: { whatsapp: "919800055566", accent: "rose" } });
    expect(page.blocks.map((b) => b.type)).toEqual(["hero", "services", "form", "contact"]);
    expect(page.url).toMatch(new RegExp(`/p/${orgSlug}/bridal-offer-2026$`));
    // Same title again gets a new address.
    const again = await json(await pagesRoute.POST(post({ title: "Bridal Offer 2026!" }), P()));
    expect((again.body.page as { slug: string }).slug).toBe("bridal-offer-2026-2");
  });

  it("validates blocks and the address; drafts don't show until published", async () => {
    actAs(owner);
    const page = (await json(await pageRoute.GET(req("/x"), PI(pageId)))).body.page as { blocks: Block[] };
    const blocks = page.blocks.map((b) => (b.type === "hero" ? { ...b, heading: "Bridal makeup that lasts all day", imageUrl: "http://insecure.example/a.jpg" } : b));
    expect((await pageRoute.PATCH(patch({ blocks }), PI(pageId))).status).toBe(400);
    expect((await pageRoute.PATCH(patch({ slug: "Bad Slug!" }), PI(pageId))).status).toBe(400);
    expect((await pageRoute.PATCH(patch({ slug: "bridal-offer-2026-2" }), PI(pageId))).status).toBe(409);
    const good = page.blocks.map((b) => (b.type === "hero" ? { ...b, heading: "Bridal makeup that lasts all day" } : b));
    const s = await json(await pageRoute.PATCH(patch({ blocks: [...good, { id: "qrblock1", type: "qr", heading: "Scan me", text: "" }], seoTitle: "Bridal makeup in Ludhiana", seoDescription: "Book a trial on WhatsApp." }), PI(pageId)));
    expect(s.status).toBe(200);
    expect(await publicPage(orgSlug, "bridal-offer-2026")).toBeNull();
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://vimeo.com/1")).toBeNull();
  });

  it("publishing checks the WhatsApp number, then the page is public; edits wait for the next publish", async () => {
    actAs(owner);
    const cur = (await json(await pageRoute.GET(req("/x"), PI(pageId)))).body.page as { theme: Record<string, unknown> };
    await pageRoute.PATCH(patch({ theme: { ...cur.theme, whatsapp: "" } }), PI(pageId));
    const bad = await json(await publishRoute.POST(post({ publish: true }), PI(pageId)));
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toContain("WhatsApp number");
    await pageRoute.PATCH(patch({ theme: { ...cur.theme, whatsapp: "919800055566" } }), PI(pageId));
    const ok = await json(await publishRoute.POST(post({ publish: true }), PI(pageId)));
    expect(ok.body.page).toMatchObject({ status: "published", unpublishedChanges: false });
    const live = await publicPage(orgSlug, "bridal-offer-2026");
    expect(live).toMatchObject({ business: "Glow Studio", seoTitle: "Bridal makeup in Ludhiana" });
    expect(live!.blocks.find((b) => b.type === "hero")).toMatchObject({ heading: "Bridal makeup that lasts all day" });

    const edited = await json(await pageRoute.PATCH(patch({ title: "Bridal Offer (new)" }), PI(pageId)));
    expect(edited.body.page).toMatchObject({ unpublishedChanges: false });
    const blocksNow = (edited.body.page as { blocks: Block[] }).blocks.map((b) => (b.type === "hero" ? { ...b, heading: "Changed headline" } : b));
    const e2 = await json(await pageRoute.PATCH(patch({ blocks: blocksNow }), PI(pageId)));
    expect(e2.body.page).toMatchObject({ unpublishedChanges: true });
    expect((await publicPage(orgSlug, "bridal-offer-2026"))!.blocks.find((b) => b.type === "hero")).toMatchObject({ heading: "Bridal makeup that lasts all day" });
  });

  it("visitors are counted; the form creates a tagged, opted-in contact with a deal and alerts the team; honeypot bots are ignored", async () => {
    const live = (await publicPage(orgSlug, "bridal-offer-2026"))!;
    const form = live.blocks.find((b) => b.type === "form")!;
    const ev = (b: unknown) => eventRoute.POST(pub(`/api/lp/${pageId}/event`, b), { params: Promise.resolve({ id: pageId }) });
    expect((await ev({ kind: "view", visitor: "v1", utmSource: "Instagram", referrer: "https://l.instagram.com/" })).status).toBe(204);
    await ev({ kind: "view", visitor: "v2" });
    await ev({ kind: "view", visitor: "v1", utmSource: "instagram" });
    await ev({ kind: "click", name: "whatsapp", visitor: "v2" });
    expect((await ev("not json")).status).toBe(204);
    expect((await ev({ kind: "delete_everything" })).status).toBe(204);

    const submit = (b: Record<string, unknown>) => submitRoute.POST(pub(`/api/lp/${pageId}/submit`, { blockId: form.id, ...b }), { params: Promise.resolve({ id: pageId }) });
    expect((await submit({ name: "Simran", phone: "12" })).status).toBe(400);
    const phone = `+9198${Date.now().toString().slice(-8)}`;
    const r = await json(await submit({ name: "Simran Kaur", phone, message: "Wedding on 12 Dec", consent: true, utmSource: "instagram", visitor: "v1" }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, created: true });
    const contact = await db.contact.findUniqueOrThrow({ where: { organizationId_phone: { organizationId: orgId, phone } }, include: { tags: { include: { tag: true } }, notes: true, deals: true } });
    expect(contact).toMatchObject({ name: "Simran Kaur", source: "landing", optInStatus: "opted_in" });
    expect(contact.tags.map((t) => t.tag.name)).toContain("Bridal enquiry");
    expect(contact.notes[0].body).toContain("Wedding on 12 Dec");
    expect(contact.deals).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: owner.id, title: { contains: "Simran Kaur" } } })).toBe(1);

    // Same number again: no duplicate contact; no consent tick → no opt-in change needed.
    const again = await json(await submit({ name: "Simran", phone, message: "Also mehndi" }));
    expect(again.body).toMatchObject({ created: false });
    expect(await db.contact.count({ where: { organizationId: orgId, phone } })).toBe(1);
    // Bot filled the hidden field: told "thanks", nothing stored.
    const before = await db.landingSubmission.count({ where: { pageId } });
    await submit({ name: "Bot", phone: "+919000000001", website: "http://spam" });
    expect(await db.landingSubmission.count({ where: { pageId } })).toBe(before);

    actAs(agent);
    const a = await json(await analyticsRoute.GET(req("/x"), PI(pageId)));
    expect(a.body).toMatchObject({ views: 3, visitors: 2, leads: 2, clicks: { whatsapp: 1 } });
    expect((a.body.sources as { source: string; views: number; leads: number }[]).find((s) => s.source === "instagram")).toMatchObject({ views: 2, leads: 1 });
    expect((a.body.submissions as unknown[]).length).toBe(2);
  });

  it("QR code, image upload, duplicate and delete", async () => {
    actAs(owner);
    const qr = await qrRoute.GET(req("/x"), PI(pageId));
    expect(qr.status).toBe(200);
    expect(qr.headers.get("content-type")).toBe("image/png");
    expect((await imagesRoute.POST(post({ upload: "data:text/html;base64,PGgxPg==" }), P())).status).toBe(400);
    expect((await imagesRoute.POST(post({ upload: "data:image/png;base64,bm90IGFuIGltYWdl" }), P())).status).toBe(400);
    const img = await json(await imagesRoute.POST(post({ upload: PNG_1PX }), P()));
    expect(img.status).toBe(201);
    const id = (img.body as { id: string }).id;
    const served = await imageRoute.GET(new Request("http://localhost:3000/x"), { params: Promise.resolve({ id }) });
    expect(served.headers.get("content-type")).toBe("image/webp");
    const dup = await json(await duplicateRoute.POST(post({}), PI(pageId)));
    expect(dup.body.page).toMatchObject({ status: "draft", title: "Bridal Offer (new) (copy)" });
    const dupId = (dup.body.page as { id: string }).id;
    actAs(agent);
    expect((await pageRoute.DELETE(req("/x", { method: "DELETE" }), PI(dupId))).status).toBe(403);
    actAs(owner);
    expect((await pageRoute.DELETE(req("/x", { method: "DELETE" }), PI(dupId))).status).toBe(200);
  });

  it("unpublished or switched-off pages disappear, and other workspaces can't touch them", async () => {
    actAs(owner);
    await publishRoute.POST(post({ publish: false }), PI(pageId));
    expect(await publicPage(orgSlug, "bridal-offer-2026")).toBeNull();
    await publishRoute.POST(post({ publish: true }), PI(pageId));
    await db.organizationService.updateMany({ where: { organizationId: orgId, service: "LANDING_PAGES" }, data: { enabled: false } });
    expect(await publicPage(orgSlug, "bridal-offer-2026")).toBeNull();
    await db.organizationService.updateMany({ where: { organizationId: orgId, service: "LANDING_PAGES" }, data: { enabled: true } });

    const other = (await makeOrg("Other")).id;
    const stranger = await makeUser({ name: "Stranger" });
    await addMember(other, stranger.id, "CLIENT_OWNER");
    await db.organizationService.create({ data: { organizationId: other, service: "LANDING_PAGES", enabled: true } });
    actAs(stranger);
    expect((await pageRoute.GET(req("/x"), PI(pageId))).status).toBe(403);
    expect((await pageRoute.GET(req("/x"), params({ orgId: other, id: pageId }))).status).toBe(404);
    expect((await pageRoute.PATCH(patch({ title: "hacked" }), params({ orgId: other, id: pageId }))).status).toBe(404);
  });
});
