import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));
// Test hosts don't resolve; the SSRF guard itself is covered in ai-knowledge.test.ts.
vi.mock("@/lib/safe-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/safe-fetch")>()), assertPublicHttpsUrl: vi.fn(async (u: string) => new URL(u)) }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as agentsRoute from "@/app/api/organizations/[orgId]/ai/agents/route";
import * as crawlRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/documents/crawl/route";
import { robotsDisallow, sameSiteLinks } from "@/services/ai/studio";
import { DEFAULT_ACTIONS, DEFAULT_HANDOFF, DEFAULT_KNOWLEDGE } from "@/lib/ai";

const long = (s: string) => `${s} `.repeat(12);
const SITE: Record<string, { type?: string; body: string; status?: number }> = {
  "https://salon.example.in/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /private\n\nUser-agent: BadBot\nDisallow: /" },
  "https://salon.example.in/": {
    body: `<title>Glow Salon</title><body><p>${long("Welcome to Glow Salon in Ludhiana, open 10am to 8pm every day.")}</p>
      <a href="/services">Services</a> <a href="/prices?utm_source=x">Prices</a> <a href="/private/staff">Staff</a>
      <a href="/cart">Cart</a> <a href="/brochure.pdf">PDF</a> <a href="https://other.example.com/x">Other</a> <a href="#top">Top</a></body>`,
  },
  "https://salon.example.in/services": { body: `<title>Services</title><body><p>${long("Haircut, facial, bridal makeup and hair spa by trained stylists.")}</p><a href="/">Home</a></body>` },
  "https://salon.example.in/prices": { body: `<title>Prices</title><body><p>${long("Haircut ₹300, facial ₹800, bridal makeup from ₹15,000.")}</p></body>` },
  "https://salon.example.in/private/staff": { body: "<title>Staff</title><body><p>secret</p></body>" },
};

afterEach(() => vi.restoreAllMocks());

describe("website reading helpers", () => {
  it("keeps same-site https links, drops files, carts, tracking params and fragments", () => {
    const links = sameSiteLinks(SITE["https://salon.example.in/"].body, "https://salon.example.in/");
    expect(links).toEqual(["https://salon.example.in/prices", "https://salon.example.in/services", "https://salon.example.in/private/staff"]);
  });
  it("reads robots.txt rules for all robots only", () => {
    expect(robotsDisallow(SITE["https://salon.example.in/robots.txt"].body)).toEqual(["/private"]);
    expect(robotsDisallow("User-agent: Googlebot\nDisallow: /x")).toEqual([]);
  });
});

describe("read a whole website into the knowledge base", () => {
  let orgId = "";
  let aid = "";
  let owner: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    orgId = (await makeOrg("Crawl Shop")).id;
    owner = await makeUser({ name: "Owner" });
    await addMember(orgId, owner.id, "CLIENT_OWNER");
    const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 1 });
    await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
    await db.organizationService.create({ data: { organizationId: orgId, service: "AI_ASSISTANT", enabled: true } });
    actAs(owner);
    const c = await json(await agentsRoute.POST(req("/x", { method: "POST", body: { name: "Salon bot", instructions: "", knowledge: DEFAULT_KNOWLEDGE, actions: DEFAULT_ACTIONS, handoff: DEFAULT_HANDOFF, accountIds: [] } }), params({ orgId })));
    aid = (c.body.agent as { id: string }).id;
  });

  it("adds each useful page once, respecting robots.txt, and skips what's already known on a second run", async () => {
    const fetched: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const u = String(input instanceof URL ? input.toString() : input);
      fetched.push(u);
      const page = SITE[u];
      if (!page) return new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
      return new Response(page.body, { status: page.status ?? 200, headers: { "content-type": page.type ?? "text/html" } });
    });
    actAs(owner);
    const r = await json(await crawlRoute.POST(req("/x", { method: "POST", body: { url: "https://salon.example.in/", maxPages: 10 } }), params({ orgId, aid })));
    expect(r.status).toBe(201);
    const added = (r.body.added as { name: string; sourceUrl: string }[]).map((a) => a.name).sort();
    expect(added).toEqual(["Glow Salon", "Prices", "Services"]);
    expect((r.body.skipped as { url: string; reason: string }[]).find((s) => s.url.includes("/private"))?.reason).toContain("robots.txt");
    expect(fetched.some((u) => u.includes("/private"))).toBe(false);
    expect(fetched.some((u) => u.includes("other.example.com") || u.endsWith(".pdf") || u.includes("/cart"))).toBe(false);
    const docs = await db.aiDocument.findMany({ where: { agentId: aid } });
    expect(docs).toHaveLength(3);
    expect(docs.find((d) => d.name === "Prices")?.content).toContain("₹15,000");

    const again = await json(await crawlRoute.POST(req("/x", { method: "POST", body: { url: "https://salon.example.in/", maxPages: 10 } }), params({ orgId, aid })));
    expect((again.body.added as unknown[]).length).toBe(0);
    expect(await db.aiDocument.count({ where: { agentId: aid } })).toBe(3);
  });

  it("refuses when the start page can't be read, and only managers can run it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500, headers: { "content-type": "text/html" } }));
    actAs(owner);
    expect((await crawlRoute.POST(req("/x", { method: "POST", body: { url: "https://down.example.in/" } }), params({ orgId, aid }))).status).toBe(400);
    const agent = await makeUser({ name: "Agent" });
    await addMember(orgId, agent.id, "AGENT");
    actAs(agent);
    expect((await crawlRoute.POST(req("/x", { method: "POST", body: { url: "https://salon.example.in/" } }), params({ orgId, aid }))).status).toBe(403);
  });
});
