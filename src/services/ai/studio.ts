import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/lib/safe-fetch";
import { htmlToText } from "@/lib/doc-extract";
import { tokenCostInr, usdToInr } from "@/lib/ai-cost";
import { addDocument, loadAgent, MAX_DOCUMENT_BYTES, saveVersion } from "@/services/ai/agents";

// ---------------------------------------------------------------------------
// Website pages as knowledge
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;

/** Fetches one public https page, re-checking every redirect hop against internal addresses. */
export async function fetchPublicPage(raw: string): Promise<{ url: string; html: string }> {
  let current = raw.trim();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: URL;
    try {
      url = await assertPublicHttpsUrl(current);
    } catch (e) {
      throw new ApiError("VALIDATION_ERROR", e instanceof UnsafeUrlError ? e.message : "Invalid URL.", { details: { url: ["Not allowed"] } });
    }
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "user-agent": "MECGURA-KnowledgeBot/1.0", accept: "text/html,text/plain;q=0.9" } });
    } catch {
      throw new ApiError("VALIDATION_ERROR", "Couldn't reach that page. Check the link and try again.", { details: { url: ["Unreachable"] } });
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      current = new URL(loc, url).toString();
      continue;
    }
    if (!res.ok) throw new ApiError("VALIDATION_ERROR", `That page answered with an error (${res.status}).`, { details: { url: [`HTTP ${res.status}`] } });
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("text/plain") && !type.includes("xhtml")) throw new ApiError("VALIDATION_ERROR", "That link isn't a web page. For PDFs or Word files, download and upload them instead.", { details: { url: ["Not HTML"] } });
    if (Number(res.headers.get("content-length") ?? 0) > MAX_PAGE_BYTES) throw new ApiError("VALIDATION_ERROR", "That page is too large to read.");
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new ApiError("VALIDATION_ERROR", "That page is too large to read.");
      }
      chunks.push(value);
    }
    const html = Buffer.concat(chunks).toString("utf8");
    return { url: url.toString(), html: type.includes("text/plain") ? html.replace(/</g, "&lt;") : html };
  }
  throw new ApiError("VALIDATION_ERROR", "That link redirects too many times.");
}

function pageText(html: string) {
  const { title, text } = htmlToText(html);
  const trimmed = Buffer.byteLength(text, "utf8") > MAX_DOCUMENT_BYTES ? Buffer.from(text, "utf8").subarray(0, MAX_DOCUMENT_BYTES).toString("utf8").replace(/�$/, "") : text;
  if (trimmed.replace(/\s/g, "").length < 50) throw new ApiError("VALIDATION_ERROR", "That page has almost no readable text (it may need JavaScript to load). Paste the text instead.", { details: { url: ["No text"] } });
  return { title, text: trimmed };
}

/** Reads a public web page (your website, menu, price list…) and saves its text as a knowledge document. */
export async function importWebsitePage(access: OrgAccess, agentId: string, rawUrl: string, req?: Request) {
  const a = await loadAgent(access.organizationId, agentId);
  const dup = await db.aiDocument.findFirst({ where: { agentId: a.id, sourceUrl: rawUrl.trim() } });
  if (dup) throw new ApiError("CONFLICT", "This page is already in the knowledge base — use Refresh to update it.");
  const page = await fetchPublicPage(rawUrl);
  const { title, text } = pageText(page.html);
  const doc = await addDocument(access, a.id, { name: title || new URL(page.url).hostname + new URL(page.url).pathname, mimeType: "text/html", content: text, sourceUrl: rawUrl.trim() });
  await audit({ action: "ai_agent.website_imported", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "ai_agent", targetId: a.id, metadata: { url: page.url }, req });
  return doc;
}

/** Re-reads a website document so the agent has the latest prices and timings. */
export async function refreshWebsitePage(access: OrgAccess, agentId: string, docId: string) {
  await loadAgent(access.organizationId, agentId);
  const d = await db.aiDocument.findFirst({ where: { id: docId, agentId, organizationId: access.organizationId } });
  if (!d) throw new ApiError("NOT_FOUND", "Document not found.");
  if (!d.sourceUrl) throw new ApiError("VALIDATION_ERROR", "Only website pages can be refreshed. Upload the file again instead.");
  const { text } = pageText((await fetchPublicPage(d.sourceUrl)).html);
  const u = await db.aiDocument.update({ where: { id: d.id }, data: { content: text, sizeBytes: Buffer.byteLength(text, "utf8"), syncedAt: new Date() } });
  return { id: u.id, name: u.name, mimeType: u.mimeType, sizeBytes: u.sizeBytes, sourceUrl: u.sourceUrl, syncedAt: u.syncedAt, createdAt: u.createdAt, changed: u.content !== d.content };
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function listVersions(organizationId: string, agentId: string) {
  await loadAgent(organizationId, agentId);
  const rows = await db.aiAgentVersion.findMany({ where: { agentId, organizationId }, orderBy: { version: "desc" } });
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.createdById).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return rows.map((r) => {
    let k = { faqs: [] as unknown[], products: [] as unknown[], services: [] as unknown[] };
    try {
      k = { ...k, ...(JSON.parse(r.knowledge) as typeof k) };
    } catch {
      /* keep empty */
    }
    return {
      id: r.id,
      version: r.version,
      note: r.note,
      instructions: r.instructions,
      summary: `${k.faqs.length} FAQ(s) · ${k.products.length} product(s) · ${k.services.length} service(s)`,
      by: users.find((u) => u.id === r.createdById)?.name ?? null,
      createdAt: r.createdAt,
    };
  });
}

/** Puts back an earlier version. The current settings are saved as a version first, so this can be undone. */
export async function restoreVersion(access: OrgAccess, agentId: string, versionId: string, req?: Request) {
  const a = await loadAgent(access.organizationId, agentId);
  const v = await db.aiAgentVersion.findFirst({ where: { id: versionId, agentId: a.id, organizationId: access.organizationId } });
  if (!v) throw new ApiError("NOT_FOUND", "Version not found.");
  await saveVersion(a, access.user.id, `Before restoring v${v.version}`);
  await db.aiAgent.update({ where: { id: a.id }, data: { instructions: v.instructions, knowledge: v.knowledge, actions: v.actions, handoff: v.handoff } });
  await audit({ action: "ai_agent.version_restored", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "ai_agent", targetId: a.id, metadata: { version: v.version }, req });
  return { version: v.version };
}

// ---------------------------------------------------------------------------
// Feedback on replies
// ---------------------------------------------------------------------------

export async function setFeedback(access: OrgAccess, agentId: string, interactionId: string, input: { rating: "good" | "bad" | ""; note?: string }) {
  await loadAgent(access.organizationId, agentId);
  const x = await db.aiInteraction.findFirst({ where: { id: interactionId, agentId, organizationId: access.organizationId } });
  if (!x) throw new ApiError("NOT_FOUND", "Reply not found.");
  if (!x.output) throw new ApiError("VALIDATION_ERROR", "Only AI replies can be rated.");
  const u = await db.aiInteraction.update({
    where: { id: x.id },
    data: input.rating ? { feedback: input.rating, feedbackNote: (input.note ?? "").slice(0, 500), feedbackById: access.user.id, feedbackAt: new Date() } : { feedback: "", feedbackNote: "", feedbackById: null, feedbackAt: null },
  });
  return { id: u.id, feedback: u.feedback, feedbackNote: u.feedbackNote };
}

// ---------------------------------------------------------------------------
// Usage and estimated cost
// ---------------------------------------------------------------------------

export async function aiUsage(organizationId: string, days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.aiInteraction.groupBy({
    by: ["agentId", "model", "mode", "isTest"],
    where: { organizationId, createdAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true },
    _count: { _all: true },
  });
  const [agents, kinds, feedback] = await Promise.all([
    db.aiAgent.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    db.aiInteraction.groupBy({ by: ["agentId", "kind"], where: { organizationId, createdAt: { gte: since }, isTest: false }, _count: { _all: true } }),
    db.aiInteraction.groupBy({ by: ["agentId", "feedback"], where: { organizationId, createdAt: { gte: since }, feedback: { not: "" } }, _count: { _all: true } }),
  ]);
  const byAgent = new Map<string, { agentId: string; name: string; calls: number; testCalls: number; inputTokens: number; outputTokens: number; costInr: number; replies: number; handoffs: number; errors: number; good: number; bad: number }>();
  const get = (id: string) => {
    let v = byAgent.get(id);
    if (!v) {
      v = { agentId: id, name: agents.find((a) => a.id === id)?.name ?? "Deleted agent", calls: 0, testCalls: 0, inputTokens: 0, outputTokens: 0, costInr: 0, replies: 0, handoffs: 0, errors: 0, good: 0, bad: 0 };
      byAgent.set(id, v);
    }
    return v;
  };
  const models = new Map<string, { model: string; inputTokens: number; outputTokens: number; costInr: number }>();
  for (const r of rows) {
    const a = get(r.agentId);
    const inT = r._sum.inputTokens ?? 0;
    const outT = r._sum.outputTokens ?? 0;
    // Demo replies are rule-based and cost nothing.
    const cost = r.mode === "live" ? tokenCostInr(r.model, inT, outT) : 0;
    a.calls += r._count._all;
    if (r.isTest) a.testCalls += r._count._all;
    a.inputTokens += inT;
    a.outputTokens += outT;
    a.costInr += cost;
    if (r.mode === "live" && r.model) {
      const m = models.get(r.model) ?? { model: r.model, inputTokens: 0, outputTokens: 0, costInr: 0 };
      m.inputTokens += inT;
      m.outputTokens += outT;
      m.costInr += cost;
      models.set(r.model, m);
    }
  }
  for (const k of kinds) {
    const a = get(k.agentId);
    if (k.kind === "reply") a.replies += k._count._all;
    if (k.kind === "handoff") a.handoffs += k._count._all;
    if (k.kind === "error") a.errors += k._count._all;
  }
  for (const f of feedback) {
    const a = get(f.agentId);
    if (f.feedback === "good") a.good += f._count._all;
    if (f.feedback === "bad") a.bad += f._count._all;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const list = [...byAgent.values()].map((a) => ({ ...a, costInr: round(a.costInr), costPerReplyInr: a.replies ? round(a.costInr / a.replies) : null, handoffRatePct: a.replies + a.handoffs ? Math.round((a.handoffs / (a.replies + a.handoffs)) * 100) : null }));
  return {
    days,
    usdToInr: usdToInr(),
    totals: {
      calls: list.reduce((s, a) => s + a.calls, 0),
      inputTokens: list.reduce((s, a) => s + a.inputTokens, 0),
      outputTokens: list.reduce((s, a) => s + a.outputTokens, 0),
      costInr: round(list.reduce((s, a) => s + a.costInr, 0)),
      good: list.reduce((s, a) => s + a.good, 0),
      bad: list.reduce((s, a) => s + a.bad, 0),
    },
    agents: list.sort((x, y) => y.costInr - x.costInr || y.calls - x.calls),
    models: [...models.values()].map((m) => ({ ...m, costInr: round(m.costInr) })),
    note: "Estimated from token counts at list prices. Your AI provider's invoice is the actual bill. Demo replies cost nothing.",
  };
}
