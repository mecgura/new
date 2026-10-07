import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { Client, BASE } from "./http-client";

/**
 * Opens every screen of the product in a real browser at five device sizes and fails on:
 * a non-2xx page, a browser console error, a failed same-origin request, horizontal page overflow,
 * placeholder text (lorem ipsum / TODO) or a visible stack trace.
 *
 * Needs a running server (E2E_BASE_URL) on the same DATABASE_URL, plus Playwright
 * (PLAYWRIGHT_CORE=/path/to/playwright-core, browser at PW_CHROMIUM — defaults to the pre-installed Chromium).
 */
const PASSWORD = `Tour-${randomBytes(6).toString("hex")}1`;
const tag = Date.now().toString(36);
const VIEWPORTS = [
  { name: "desktop 1920", width: 1920, height: 1080 },
  { name: "laptop 1366", width: 1366, height: 768 },
  { name: "tablet 820", width: 820, height: 1180 },
  { name: "android 412", width: 412, height: 915 },
  { name: "iphone 390", width: 390, height: 844 },
];
const ids: Record<string, string> = {};
const emails = { admin: `tour-admin-${tag}@e2e.local`, owner: `tour-owner-${tag}@e2e.local` };
let orgId = "";

// playwright-core is not a project dependency (browser tooling lives outside the repo), so it is loaded dynamically and typed loosely.
/* eslint-disable @typescript-eslint/no-explicit-any */
type PW = { chromium: { launch: (o: { executablePath: string }) => Promise<any> } };
let pw: PW | null = null;

beforeAll(async () => {
  try {
    pw = (await import(/* @vite-ignore */ process.env.PLAYWRIGHT_CORE ?? "playwright-core")) as PW;
  } catch {
    pw = null;
  }
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await db.user.create({ data: { email: emails.admin, name: "Tour Admin", passwordHash, role: "SUPER_ADMIN" } });
  const owner = await db.user.create({ data: { email: emails.owner, name: "Tour Owner", passwordHash, role: "USER" } });
  const org = await db.organization.create({ data: { name: `Tour Org ${tag}`, slug: `tour-${tag}` } });
  orgId = org.id;
  await db.organizationMember.create({ data: { organizationId: org.id, userId: owner.id, role: "CLIENT_OWNER" } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  const plan = await db.plan.findFirst({ where: { slug: "growth" } });
  if (plan) await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  ids.orgId = org.id;

  // Demo WhatsApp connection + a customer message, through the real API.
  const c = new Client();
  expect(await c.login(emails.owner, PASSWORD)).toBe(true);
  const post = (p: string, body: unknown) => c.fetch(`/api/organizations/${org.id}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await post("/whatsapp/connect/demo", { businessName: "Tour Store" })).status).toBe(201);
  const acct = await db.whatsAppAccount.findFirstOrThrow({ where: { organizationId: org.id } });
  ids.account = acct.id;
  await post("/inbox/demo/inbound", { whatsappAccountId: acct.id, phone: "+919800000777", name: "Tour Customer", body: "hello" });
  const contact = await db.contact.findFirstOrThrow({ where: { organizationId: org.id } });
  ids.contact = contact.id;
  const tpl = await db.messageTemplate.create({ data: { organizationId: org.id, wabaRecordId: acct.wabaRecordId!, name: "tour_tpl", language: "en", category: "UTILITY", status: "approved", body: "Hello {{1}}" } });
  ids.template = tpl.id;
  ids.campaign = (await db.campaign.create({ data: { organizationId: org.id, name: "Tour campaign", whatsappAccountId: acct.id, templateId: tpl.id } })).id;
  ids.automation = (await db.automation.create({ data: { organizationId: org.id, name: "Tour automation", whatsappAccountId: acct.id } })).id;
  ids.flow = (await db.flow.create({ data: { organizationId: org.id, wabaRecordId: acct.wabaRecordId, name: "Tour flow", category: "LEAD_GENERATION" } })).id;
  const inv = await db.invoice.create({ data: { organizationId: org.id, number: `INV-TOUR-${tag}`, dueAt: new Date(), total: 100, subtotal: 100 } });
  ids.invoice = inv.id;
  const client = await db.organization.findFirst({ where: { id: org.id }, select: { id: true } });
  ids.client = client!.id;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
});

const CLIENT_PAGES = [
  "/dashboard", "/dashboard/whatsapp", "/whatsapp/accounts", "/whatsapp/accounts/{account}", "/whatsapp/connect", "/whatsapp/quality",
  "/inbox", "/contacts", "/contacts/{contact}", "/templates", "/templates/new", "/templates/{template}", "/campaigns", "/campaigns/{campaign}",
  "/automations", "/automations/{automation}", "/flows", "/flows/{flow}", "/ai", "/analytics", "/api", "/webhooks", "/billing", "/billing/invoices/{invoice}",
  "/team", "/settings", "/settings/organization", "/settings/security",
];
const ADMIN_PAGES = [
  "/admin", "/admin/clients", "/admin/clients/{client}", "/admin/clients/new", "/admin/users", "/admin/whatsapp", "/admin/billing", "/admin/usage", "/admin/analytics",
  "/admin/audit-logs", "/admin/settings",
];
const PUBLIC_PAGES = ["/login", "/forgot-password"];

const fillPath = (p: string) => p.replace(/\{(\w+)\}/g, (_, k) => ids[k] ?? "missing");

async function tour(who: Client | null, pages: string[], label: string) {
  if (!pw) return console.warn("playwright-core not available — tour skipped");
  const browser = await pw.chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const problems: string[] = [];
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      if (who) await ctx.addCookies([...who.jar].map(([name, value]) => ({ name, value, url: BASE })));
      const page = await ctx.newPage();
      let current = "";
      const note = (m: string) => problems.push(`[${label} ${vp.name}] ${current}: ${m}`);
      page.on("console", (m: any) => m.type() === "error" && note(`console error: ${m.text().slice(0, 160)}`));
      page.on("pageerror", (e: unknown) => note(`page error: ${String(e).slice(0, 160)}`));
      page.on("response", (r: any) => {
        if (r.url().startsWith(BASE) && r.status() >= 400 && !/\/_next\/image|favicon/.test(r.url())) note(`${r.status()} ${new URL(r.url()).pathname}`);
      });
      for (const raw of pages) {
        current = fillPath(raw);
        const res = await page.goto(`${BASE}${current}`, { waitUntil: "networkidle", timeout: 45_000 }).catch((e: unknown) => (note(`navigation failed: ${String(e).slice(0, 80)}`), null));
        if (!res) continue;
        if (res.status() >= 400) note(`page status ${res.status()}`);
        if (new URL(page.url()).pathname !== current && !current.startsWith("/login")) note(`redirected to ${new URL(page.url()).pathname}`);
        const probe = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          text: document.body.innerText,
        }));
        if (probe.overflow > 1) note(`horizontal overflow ${probe.overflow}px`);
        if (/lorem ipsum|\bTODO\b|undefined|\[object Object\]|NaN%|at \w+ \(.*:\d+:\d+\)/i.test(probe.text)) note("placeholder / debug text on the page");
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  expect(problems, "\n  " + problems.slice(0, 40).join("\n  ") + (problems.length > 40 ? `\n  …and ${problems.length - 40} more` : "")).toEqual([]);
}

describe("multi-viewport tour (desktop, laptop, tablet, Android, iPhone)", () => {
  it("sign-in pages", async () => {
    await tour(null, PUBLIC_PAGES, "public");
  }, 600_000);
  it("workspace owner: every client screen", async () => {
    const c = new Client();
    expect(await c.login(emails.owner, PASSWORD)).toBe(true);
    await tour(c, CLIENT_PAGES, "client");
  }, 900_000);
  it("super admin: every admin screen", async () => {
    const c = new Client();
    expect(await c.login(emails.admin, PASSWORD)).toBe(true);
    await tour(c, ADMIN_PAGES, "admin");
  }, 900_000);
});
