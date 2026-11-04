import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deflateRawSync } from "node:zlib";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));
// Test hosts don't resolve; the real SSRF check is exercised separately below.
vi.mock("@/lib/safe-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/safe-fetch")>()), assertPublicHttpsUrl: vi.fn(async (u: string) => new URL(u)) }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as agentsRoute from "@/app/api/organizations/[orgId]/ai/agents/route";
import * as agentRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/route";
import * as docsRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/documents/route";
import * as importRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/documents/import/route";
import * as refreshRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/documents/[did]/refresh/route";
import * as versionsRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/versions/route";
import * as restoreRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/versions/[vid]/restore/route";
import * as interactionsRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/interactions/route";
import * as feedbackRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/interactions/[iid]/feedback/route";
import * as usageRoute from "@/app/api/organizations/[orgId]/ai/usage/route";
import { docxToText, htmlToText, pdfToText } from "@/lib/doc-extract";
import { DEFAULT_ACTIONS, DEFAULT_HANDOFF, DEFAULT_KNOWLEDGE, MAX_DOC_CHARS, relevantPassages, type AgentConfig } from "@/lib/ai";
import { tokenCostInr } from "@/lib/ai-cost";

/** Minimal .docx: a ZIP holding word/document.xml. */
function makeDocx(paragraphs: string[]): Buffer {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`;
  const name = Buffer.from("word/document.xml");
  const raw = Buffer.from(xml);
  const data = deflateRawSync(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdStart = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, name, data, central, name, eocd]);
}

/** Minimal one-page PDF with a text layer. */
function makePdf(lines: string[]): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td ${lines.map((l, i) => `${i ? "0 -16 Td " : ""}(${l}) Tj`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

const upload = (name: string, bytes: Buffer, type: string) => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name, { type }));
  return new Request("http://localhost:3000/x", { method: "POST", body: form, headers: { host: "localhost:3000" } });
};
const post = (body?: unknown) => req("/x", { method: "POST", body });
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

describe("knowledge extraction", () => {
  it("reads Word, PDF and web pages as text", async () => {
    expect(docxToText(makeDocx(["Bridal makeup &amp; hair: ₹15,000", "Open 10am–8pm"]))).toBe("Bridal makeup & hair: ₹15,000\nOpen 10am–8pm");
    const pdf = await pdfToText(makePdf(["Home delivery within 5 km is free.", "Orders above Rs 500 only."]));
    expect(pdf).toContain("Home delivery within 5 km is free.");
    await expect(pdfToText(Buffer.from("not a pdf"))).rejects.toThrow(/valid PDF/);
    const page = htmlToText("<html><head><title>Menu | Sweet Shop</title><script>var x=1</script></head><body><nav>Home About</nav><h1>Menu</h1><ul><li>Kaju katli ₹900/kg</li><li>Rasgulla ₹400/kg</li></ul><footer>© 2026</footer></body></html>");
    expect(page.title).toBe("Menu | Sweet Shop");
    expect(page.text).toBe("Menu\n\n- Kaju katli ₹900/kg\n- Rasgulla ₹400/kg");
  });

  it("never fetches internal addresses", async () => {
    const { assertPublicHttpsUrl } = await vi.importActual<typeof import("@/lib/safe-fetch")>("@/lib/safe-fetch");
    await expect(assertPublicHttpsUrl("https://127.0.0.1/admin")).rejects.toThrow(/Private or internal/);
    await expect(assertPublicHttpsUrl("http://example.com")).rejects.toThrow(/https/);
    await expect(assertPublicHttpsUrl("https://metadata.internal/")).rejects.toThrow(/Internal/);
  });

  it("adds the passages that match the question from text beyond the fixed budget", () => {
    const filler = "General information about our company history and values. ".repeat(Math.ceil(MAX_DOC_CHARS / 58) + 10);
    const cfg: AgentConfig = {
      name: "A",
      businessName: "B",
      instructions: "",
      knowledge: DEFAULT_KNOWLEDGE,
      actions: DEFAULT_ACTIONS,
      handoff: DEFAULT_HANDOFF,
      documents: [{ name: "Handbook", content: `${filler}\n\nWarranty: the water purifier has a two year warranty on the motor.\n\nParking is available behind the building.` }],
    };
    const out = relevantPassages(cfg, "What warranty does the purifier have?");
    expect(out).toContain("two year warranty");
    expect(relevantPassages(cfg, "hello")).toBe("");
    expect(relevantPassages({ ...cfg, documents: [{ name: "Short", content: "Warranty two years." }] }, "warranty")).toBe("");
  });

  it("estimates cost from tokens", () => {
    vi.stubEnv("AI_USD_INR", "80");
    expect(tokenCostInr("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(48);
    expect(tokenCostInr("claude-sonnet-5-5-preview", 1_000_000, 0)).toBeCloseTo(160);
    expect(tokenCostInr("claude-haiku-5-5", 0, 0)).toBe(0);
    vi.unstubAllEnvs();
  });
});

describe("AI studio for an agent", () => {
  type U = Awaited<ReturnType<typeof makeUser>>;
  let orgId = "";
  let owner: U, agentUser: U;
  let aid = "";
  const P = <E extends Record<string, string> = Record<never, string>>(extra?: E) => params({ orgId, aid, ...(extra ?? ({} as E)) });

  beforeAll(async () => {
    orgId = (await makeOrg("Knowledge Shop")).id;
    [owner, agentUser] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" })]);
    await addMember(orgId, owner.id, "CLIENT_OWNER");
    await addMember(orgId, agentUser.id, "AGENT");
    const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 1 });
    await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
    await db.organizationService.create({ data: { organizationId: orgId, service: "AI_ASSISTANT", enabled: true } });
    actAs(owner);
    const c = await json(await agentsRoute.POST(post({ name: "Shop helper", instructions: "Be brief.", knowledge: DEFAULT_KNOWLEDGE, actions: DEFAULT_ACTIONS, handoff: DEFAULT_HANDOFF, accountIds: [] }), params({ orgId })));
    expect(c.status).toBe(201);
    aid = (c.body.agent as { id: string }).id;
  });
  afterEach(() => vi.restoreAllMocks());

  it("uploads PDF and Word files as text", async () => {
    actAs(owner);
    const p = await json(await docsRoute.POST(upload("menu.pdf", makePdf(["Veg thali Rs 250 with two rotis", "Sweet lassi Rs 80"]), "application/pdf"), P()));
    expect(p.status).toBe(201);
    expect(p.body.document).toMatchObject({ name: "menu.pdf", mimeType: "application/pdf" });
    const w = await json(await docsRoute.POST(upload("policy.docx", makeDocx(["Refunds within 7 days."]), "application/octet-stream"), P()));
    expect(w.status).toBe(201);
    const saved = await db.aiDocument.findFirstOrThrow({ where: { agentId: aid, name: "policy.docx" } });
    expect(saved.content).toBe("Refunds within 7 days.");
    const bad = await json(await docsRoute.POST(upload("old.doc", Buffer.from("x"), "application/msword"), P()));
    expect(bad.status).toBe(400);
    expect(String(bad.body.error)).toContain(".docx");
  });

  it("learns a website page, refuses duplicates and refreshes it", async () => {
    actAs(owner);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/services" } })).mockResolvedValueOnce(html("<title>Services</title><body><p>Haircut ₹300. Facial ₹800. Bridal makeup from ₹15,000. Open all days 10am to 8pm.</p></body>"));
    const r = await json(await importRoute.POST(post({ url: "https://salon.example.in/old" }), P()));
    expect(r.status).toBe(201);
    expect(r.body.document).toMatchObject({ name: "Services", sourceUrl: "https://salon.example.in/old" });
    expect(String(spy.mock.calls[1][0])).toBe("https://salon.example.in/services");
    expect((await importRoute.POST(post({ url: "https://salon.example.in/old" }), P())).status).toBe(409);

    spy.mockResolvedValueOnce(html("<body><p>Haircut ₹350. Facial ₹800. Bridal makeup from ₹15,000. Open all days 10am to 8pm.</p></body>"));
    const did = (r.body.document as { id: string }).id;
    const f = await json(await refreshRoute.POST(post({}), P({ did })));
    expect(f.body.document).toMatchObject({ changed: true });
    expect((await db.aiDocument.findUniqueOrThrow({ where: { id: did } })).content).toContain("₹350");

    spy.mockResolvedValueOnce(html("<body><div id=app></div><script>render()</script></body>"));
    expect((await importRoute.POST(post({ url: "https://spa.example.in/" }), P())).status).toBe(400);
    actAs(agentUser);
    expect((await importRoute.POST(post({ url: "https://x.example.in/" }), P())).status).toBe(403);
  });

  it("keeps versions of the instructions and can restore one", async () => {
    actAs(owner);
    await agentRoute.PATCH(req("/x", { method: "PATCH", body: { instructions: "Version two: reply in Punjabi." } }), P());
    const renamed = await json(await agentRoute.PATCH(req("/x", { method: "PATCH", body: { name: "Renamed only" } }), P())); // no new version for a rename
    expect(renamed.body.agent).toMatchObject({ name: "Renamed only", instructions: "Version two: reply in Punjabi." }); // other fields untouched
    const v = await json(await versionsRoute.GET(req("/x"), P()));
    const versions = v.body.versions as { id: string; version: number; instructions: string }[];
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, instructions: "Be brief." });
    const back = await json(await restoreRoute.POST(post({}), P({ vid: versions[0].id })));
    expect(back.body.agent).toMatchObject({ instructions: "Be brief." });
    const after = (await json(await versionsRoute.GET(req("/x"), P()))).body.versions as { instructions: string; note: string }[];
    expect(after[0]).toMatchObject({ instructions: "Version two: reply in Punjabi.", note: "Before restoring v1" });
    actAs(agentUser);
    expect((await versionsRoute.GET(req("/x"), P())).status).toBe(403);
  });

  it("team members rate replies; owners see usage and estimated cost", async () => {
    const x = await db.aiInteraction.create({ data: { organizationId: orgId, agentId: aid, mode: "live", kind: "reply", input: "price?", output: "₹300", model: "claude-haiku-5-5", inputTokens: 2_000_000, outputTokens: 100_000 } });
    const skip = await db.aiInteraction.create({ data: { organizationId: orgId, agentId: aid, mode: "live", kind: "skipped" } });
    actAs(agentUser);
    const fb = await json(await feedbackRoute.POST(post({ rating: "bad", note: "Price is ₹350 now" }), P({ iid: x.id })));
    expect(fb.body.interaction).toMatchObject({ feedback: "bad", feedbackNote: "Price is ₹350 now" });
    expect((await feedbackRoute.POST(post({ rating: "good" }), P({ iid: skip.id }))).status).toBe(400);
    const bad = await json(await interactionsRoute.GET(req("/x?feedback=bad"), P()));
    expect((bad.body.interactions as { id: string }[]).map((i) => i.id)).toEqual([x.id]);
    expect((await usageRoute.GET(req("/x"), params({ orgId }))).status).toBe(403);

    actAs(owner);
    vi.stubEnv("AI_USD_INR", "88");
    const u = await json(await usageRoute.GET(req("/x?days=30"), params({ orgId })));
    expect(u.status).toBe(200);
    const row = (u.body.agents as { agentId: string; replies: number; bad: number; costInr: number; costPerReplyInr: number }[]).find((a) => a.agentId === aid)!;
    // 2M input × $0.10 + 0.1M output × $0.50 = $0.25 → ₹22
    expect(row).toMatchObject({ replies: 1, bad: 1, costInr: 22, costPerReplyInr: 22 });
    vi.unstubAllEnvs();

    const stranger = await makeUser({ name: "Stranger" });
    const other = await makeOrg("Other knowledge");
    await addMember(other.id, stranger.id, "CLIENT_OWNER");
    actAs(stranger);
    expect((await feedbackRoute.POST(post({ rating: "good" }), params({ orgId: other.id, aid, iid: x.id }))).status).toBe(404);
  });
});
