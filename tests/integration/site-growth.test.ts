import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { actAs, json, makeUser, req } from "../helpers";
import * as leadRoute from "@/app/api/site-lead/route";
import * as resultsAdmin from "@/app/api/admin/site-results/route";
import { getPublishedResults } from "@/services/site/results";
import { INDUSTRIES, CITIES } from "@/config/seo-pages";
import { TEMPLATE_PACK } from "@/config/template-pack";
import { resetRateLimits } from "@/lib/rate-limit";

const form = (body: Record<string, unknown>, ip = "203.0.113.20") => new Request("http://x/api/site-lead", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
const OK = { name: "Ravi Kumar", phone: "98765 43210", business: "Ravi Salon", city: "Ludhiana", need: "pricing", message: "Need price", consent: true, company: "" };
let admin: Awaited<ReturnType<typeof makeUser>>;
let n = 0;
const phone = () => `9${String(Date.now()).slice(-8)}${n++ % 10}`;

beforeAll(async () => {
  admin = await makeUser({ name: "Admin", role: "SUPER_ADMIN" });
});

describe("website lead form", () => {
  it("saves a lead with its source and note, and a repeat is the same lead", async () => {
    resetRateLimits();
    const p = phone();
    const r = await leadRoute.POST(form({ ...OK, phone: p, page: "/whatsapp-automation/salon", medium: "google", campaign: "seo" }));
    expect(r.status).toBe(201);
    const lead = await db.marketingLead.findFirstOrThrow({ where: { phone: `+91${p}` }, include: { activities: true } });
    expect(lead).toMatchObject({ name: "Ravi Kumar", business: "Ravi Salon", city: "Ludhiana", source: "website_form", medium: "google", campaign: "seo" });
    expect(lead.activities.map((a) => a.text).join(" ")).toContain("Wants pricing");
    expect(lead.activities.map((a) => a.text).join(" ")).toContain("/whatsapp-automation/salon");
    await leadRoute.POST(form({ ...OK, phone: p }));
    expect(await db.marketingLead.count({ where: { phone: `+91${p}` } })).toBe(1);
  });

  it("needs consent and a valid number; a filled honeypot saves nothing", async () => {
    resetRateLimits();
    expect((await leadRoute.POST(form({ ...OK, phone: phone(), consent: false }))).status).toBe(400);
    expect((await leadRoute.POST(form({ ...OK, phone: "12" }))).status).toBe(400);
    const bot = phone();
    expect((await leadRoute.POST(form({ ...OK, phone: bot, company: "Spam Ltd" }))).status).toBe(201);
    expect(await db.marketingLead.count({ where: { phone: `+91${bot}` } })).toBe(0);
    expect((await leadRoute.POST(form({ ...OK, phone: phone(), extra: "x" }))).status).toBe(400);
  });

  it("is rate limited per visitor", async () => {
    resetRateLimits();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await leadRoute.POST(form({ ...OK, phone: phone() }, "198.51.100.77"))).status);
    expect(codes.slice(0, 5).every((c) => c === 201), codes.join(",")).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it("a referral saves the introduced business as a referral lead and notes who referred", async () => {
    resetRateLimits();
    const friend = phone();
    expect((await leadRoute.POST(form({ kind: "referral", name: "Meena", phone: "98000 11122", friendName: "Gupta Store", friendPhone: friend, business: "Gupta General Store", consent: true, company: "" }))).status).toBe(201);
    const lead = await db.marketingLead.findFirstOrThrow({ where: { phone: `+91${friend}` }, include: { activities: true } });
    expect(lead).toMatchObject({ source: "referral", name: "Gupta Store" });
    expect(lead.activities.map((a) => a.text).join(" ")).toContain("Referred by Meena");
    expect((await leadRoute.POST(form({ kind: "referral", name: "Meena", phone: "98000 11122", consent: true, company: "" }))).status).toBe(400);
  });

  it("the template pack lead says what they downloaded", async () => {
    resetRateLimits();
    const p = phone();
    await leadRoute.POST(form({ kind: "template_pack", name: "Asha", phone: p, consent: true, company: "", page: "/resources/whatsapp-message-templates" }));
    const lead = await db.marketingLead.findFirstOrThrow({ where: { phone: `+91${p}` }, include: { activities: true } });
    expect(lead.activities.map((a) => a.text).join(" ")).toContain("template pack");
  });
});

describe("case studies", () => {
  it("nothing is public until published, and publishing needs the client's OK", async () => {
    actAs(admin);
    expect(await getPublishedResults()).toEqual([]);
    const item = { id: "glow-studio", business: "Glow Studio", type: "Salon", city: "Ludhiana", challenge: "Enquiries were answered late.", solution: "Instant replies and a booking flow.", results: [{ label: "Leads per month", value: "120" }], quote: "", quoteBy: "", clientApproved: false, published: true };
    expect((await resultsAdmin.PUT(req("/x", { method: "PUT", body: { items: [item] } }))).status).toBe(400);
    expect((await json(await resultsAdmin.PUT(req("/x", { method: "PUT", body: { items: [{ ...item, clientApproved: true }] } })))).status).toBe(200);
    expect((await getPublishedResults()).map((c) => c.business)).toEqual(["Glow Studio"]);
    await resultsAdmin.PUT(req("/x", { method: "PUT", body: { items: [{ ...item, clientApproved: true, published: false }] } }));
    expect(await getPublishedResults()).toEqual([]);
    expect((await resultsAdmin.PUT(req("/x", { method: "PUT", body: { items: [{ ...item, clientApproved: true, quote: "Great!", quoteBy: "" }] } }))).status).toBe(400);
  });
});

describe("page content", () => {
  it("every industry and city has what its page needs", () => {
    expect(new Set(INDUSTRIES.map((i) => i.slug)).size).toBe(INDUSTRIES.length);
    for (const i of INDUSTRIES) {
      expect(i.problems.length, i.slug).toBeGreaterThanOrEqual(4);
      expect(i.faqs.length, i.slug).toBeGreaterThanOrEqual(3);
      expect(i.chat.length, i.slug).toBeGreaterThanOrEqual(4);
      expect(i.setup.length, i.slug).toBeGreaterThanOrEqual(5);
    }
    expect(new Set(CITIES.map((c) => c.slug)).size).toBe(CITIES.length);
  });
  it("template pack: 22 templates, unique names, variables numbered in order, OTP is authentication", () => {
    expect(TEMPLATE_PACK).toHaveLength(22);
    expect(new Set(TEMPLATE_PACK.map((t) => t.name)).size).toBe(22);
    for (const t of TEMPLATE_PACK) {
      const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      const max = Math.max(0, ...vars);
      expect(new Set(vars).size, t.name).toBe(max);
      expect(t.body.length, t.name).toBeLessThanOrEqual(1024);
      expect(t.name).toMatch(/^[a-z0-9_]+$/);
    }
    expect(TEMPLATE_PACK.find((t) => t.name === "otp_code")?.category).toBe("AUTHENTICATION");
  });
});
