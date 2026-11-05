import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as mediaRoute from "@/app/api/organizations/[orgId]/automations/media/route";
import * as publicMedia from "@/app/api/automation-media/[key]/route";
import * as quickRoute from "@/app/api/organizations/[orgId]/automations/quick/route";
import { runDueAutomations } from "@/services/automations/engine";
import { receiveInbound, toPayload } from "@/services/inbox/messaging";
import { QUICK_DEFAULTS } from "@/lib/quick-flow";
import { validateGraph } from "@/lib/automations";
import { quickFlowGraph } from "@/lib/quick-flow";

const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 1)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 2)]);
const AD = "120200000000999";
let orgId = "";
let accountId = "";
let agent: Awaited<ReturnType<typeof makeUser>>;
let owner: Awaited<ReturnType<typeof makeUser>>;
let n = 0;
const phone = () => `+9195${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;

async function drain() {
  for (let i = 0; i < 30; i++) {
    const r = await runDueAutomations(20_000);
    if (!r.ran && !r.scheduled) return;
  }
}
async function say(from: string, body: string, type: "text" | "button" = "text", ad = false) {
  const referral = ad ? { sourceType: "ad", sourceId: AD, sourceUrl: "", headline: "Offer", body: "", ctwaClid: "" } : undefined;
  const r = await receiveInbound(orgId, accountId, { externalId: `t.${randomUUID()}`, fromPhone: from, profileName: "Simran", type, body, at: new Date(), isDemo: true, ...(referral ? { referral } : {}) });
  await drain();
  return r!;
}
async function upload(buf: Buffer, filename: string) {
  return json(await mediaRoute.POST(post({ filename, data: `data:application/octet-stream;base64,${buf.toString("base64")}` }), P(orgId)));
}

beforeAll(async () => {
  orgId = (await makeOrg("Easy Flow")).id;
  [owner, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: orgId, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: "Easy Flow" }), P(orgId)));
  accountId = (d.body.account as { id: string }).id;
});

describe("automation images & brochures", () => {
  it("uploads a PNG and a PDF, serves them publicly, and rejects other files", async () => {
    const img = await upload(PNG, "poster.png");
    expect(img.status).toBe(201);
    expect(img.body.media).toMatchObject({ kind: "image" });
    const key = String((img.body.media as { url: string }).url).split("/").pop()!;
    const got = await publicMedia.GET(new Request("http://x"), { params: Promise.resolve({ key }) });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    const pdf = await upload(PDF, "Our Brochure.pdf");
    expect(pdf.body.media).toMatchObject({ kind: "document", filename: "Our Brochure.pdf" });
    expect((await upload(Buffer.from("<html>nope</html>"), "x.html")).status).toBe(400);
    expect((await upload(Buffer.concat([Buffer.from("%PDF"), Buffer.alloc(3.2 * 1024 * 1024)]), "big.pdf")).status).toBe(400);
    expect((await publicMedia.GET(new Request("http://x"), { params: Promise.resolve({ key: "does-not-exist-000000000" }) })).status).toBe(404);
    actAs(agent);
    expect((await upload(PNG, "x.png")).status).toBe(403);
    actAs(owner);
  });

  it("buttons can carry an image or brochure on top", () => {
    const p = toPayload({ type: "interactive", body: "Hi", buttons: [{ id: "b1", title: "Price" }], header: { kind: "document", link: "https://x/y.pdf", filename: "B.pdf" } });
    expect(p.payload).toMatchObject({ interactive: { header: { type: "document", document: { link: "https://x/y.pdf", filename: "B.pdf" } } } });
  });
});

describe("Easy setup", () => {
  it("builds a valid flow with and without the optional files", () => {
    expect(validateGraph(quickFlowGraph(QUICK_DEFAULTS)).errors).toEqual([]);
    expect(validateGraph(quickFlowGraph({ ...QUICK_DEFAULTS, start: "keyword", keywords: ["price"], brochure: { kind: "document", url: "https://x/b.pdf", filename: "b.pdf" } })).errors).toEqual([]);
  });

  it("one form → live automation: image welcome, brochure, buttons, price, call booking", async () => {
    const img = (await upload(PNG, "offer.png")).body.media as { kind: "image"; url: string; filename: string };
    const pdf = (await upload(PDF, "Brochure.pdf")).body.media as { kind: "document"; url: string; filename: string };
    const r = await json(
      await quickRoute.POST(
        post({ ...QUICK_DEFAULTS, name: "Ad flow", whatsappAccountId: accountId, adIds: [AD], welcomeImage: img, brochure: pdf, priceText: "💰 Website ₹9,999 · Ads ₹4,999/month" }),
        P(orgId)
      )
    );
    expect(r.status).toBe(201);
    expect(r.body.automation).toMatchObject({ status: "active", triggerType: "ad_click" });

    const from = phone();
    const first = await say(from, "Hi", "text", true);
    let out = await db.message.findMany({ where: { conversationId: first.conversationId, direction: "outbound" }, orderBy: { createdAt: "asc" } });
    expect(out.map((m) => m.type)).toEqual(["image", "document", "interactive"]);
    expect(out[0].body).toContain("Namaste");
    expect(out[1].body).toContain("brochure");

    await say(from, "Price list", "button");
    await say(from, "Call karo", "button");
    await say(from, "Simran Kaur");
    await say(from, "Kal shaam", "button");
    out = await db.message.findMany({ where: { conversationId: first.conversationId, direction: "outbound" }, orderBy: { createdAt: "asc" } });
    expect(out.some((m) => m.body.includes("₹9,999"))).toBe(true);
    expect(out.at(-1)!.body).toContain("(Kal shaam)");
    const c = await db.contact.findUniqueOrThrow({ where: { id: first.contactId }, include: { tags: { include: { tag: true } } } });
    expect(c).toMatchObject({ name: "Simran Kaur", leadStatus: "qualified" });
    expect(c.tags.map((t) => t.tag.name)).toContain("Call requested");

    // Not from the ad → this flow doesn't run.
    const other = await say(phone(), "Hi");
    expect(await db.message.count({ where: { conversationId: other.conversationId, direction: "outbound" } })).toBe(0);
  });

  it("rejects an empty price list", async () => {
    expect((await quickRoute.POST(post({ ...QUICK_DEFAULTS, name: "x", priceText: "" }), P(orgId))).status).toBe(400);
  });
});
