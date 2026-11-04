import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/lib/safe-fetch";
import { htmlToText } from "@/lib/doc-extract";
import { tokenCostInr, usdToInr } from "@/lib/ai-cost";
import { addDocument, loadAgent, MAX_DOCUMENT_BYTES, MAX_DOCUMENTS, saveVersion } from "@/services/ai/agents";

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
// Whole website (several pages of one site)
// ---------------------------------------------------------------------------

export const MAX_CRAWL_PAGES = 15;
const CRAWL_BUDGET_MS = 45_000;
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|mp4|mp3|webm|avi|mov|docx?|xlsx?|pptx?|css|js|json|xml|txt)$/i;
const SKIP_PATH = /\/(wp-admin|wp-login|cart|checkout|my-account|account|login|signin|signup|register|logout|feed|tag|author|search)(\/|$)/i;

/** Same-site links on a page, absolute, without #fragments, de-duplicated (shorter paths first). */
export function sameSiteLinks(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    let u: URL;
    try {
      u = new URL(m[1].trim(), base);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" || u.hostname !== base.hostname || SKIP_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname)) continue;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|replytocom$)/i.test(k)) u.searchParams.delete(k);
    out.add(u.toString().replace(/\/$/, "") || u.toString());
  }
  return [...out].sort((a, b) => a.length - b.length);
}

/** `Disallow:` prefixes for all robots (User-agent: *). Missing or unreadable robots.txt = allowed. */
export function robotsDisallow(txt: string): string[] {
  const out: string[] = [];
  let applies = false;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (key === "user-agent") {
      applies = (lastWasAgent && applies) || m[2].trim() === "*";
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (applies && key === "disallow" && m[2].trim()) out.push(m[2].trim());
  }
  return out;
}

/**
 * Reads up to `maxPages` pages of one public website (starting page first, then its same-site links),
 * respecting robots.txt, and saves each page with real text as its own knowledge document.
 */
export async function importWebsite(access: OrgAccess, agentId: string, startUrl: string, maxPages = 10, req?: Request) {
  const a = await loadAgent(access.organizationId, agentId);
  const limit = Math.min(MAX_CRAWL_PAGES, Math.max(1, maxPages), MAX_DOCUMENTS - a.documents.length);
  if (limit <= 0) throw new ApiError("VALIDATION_ERROR", `This agent already has ${MAX_DOCUMENTS} documents. Remove some first.`);
  const started = Date.now();
  let disallow: string[] = [];
  try {
    const origin = new URL(startUrl.trim()).origin;
    disallow = robotsDisallow((await fetchPublicPage(`${origin}/robots.txt`)).html.replace(/&lt;/g, "<"));
  } catch {
    /* no robots.txt → allowed */
  }
  const blocked = (u: string) => disallow.some((d) => new URL(u).pathname.startsWith(d));
  const known = new Set((await db.aiDocument.findMany({ where: { agentId: a.id }, select: { sourceUrl: true } })).map((d) => d.sourceUrl.replace(/\/$/, "")));
  const queue = [startUrl.trim()];
  const seen = new Set<string>();
  const added: { id: string; name: string; sourceUrl: string }[] = [];
  const skipped: { url: string; reason: string }[] = [];
  let host = "";
  while (queue.length && added.length < limit) {
    if (Date.now() - started > CRAWL_BUDGET_MS) {
      skipped.push({ url: queue[0], reason: "Time limit reached — run it again to read more pages." });
      break;
    }
    const url = queue.shift()!;
    const key = url.replace(/\/$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > limit * 4) break; // don't wander through huge sites
    if (blocked(url)) {
      skipped.push({ url, reason: "Blocked by the site's robots.txt" });
      continue;
    }
    let page: { url: string; html: string };
    try {
      page = await fetchPublicPage(url);
    } catch (e) {
      skipped.push({ url, reason: e instanceof Error ? e.message : "Couldn't read" });
      if (!host) throw e; // the starting page itself failed
      continue;
    }
    const final = new URL(page.url);
    if (!host) host = final.hostname;
    else if (final.hostname !== host) {
      skipped.push({ url, reason: "Leads to another website" });
      continue;
    }
    for (const l of sameSiteLinks(page.html, page.url)) if (!seen.has(l.replace(/\/$/, ""))) queue.push(l);
    if (known.has(key) || known.has(page.url.replace(/\/$/, ""))) {
      skipped.push({ url, reason: "Already in the knowledge base" });
      continue;
    }
    let text: { title: string; text: string };
    try {
      text = pageText(page.html);
    } catch (e) {
      skipped.push({ url, reason: e instanceof Error ? e.message : "No text" });
      continue;
    }
    const doc = await addDocument(access, a.id, { name: text.title || final.pathname || final.hostname, mimeType: "text/html", content: text.text, sourceUrl: url });
    known.add(key);
    added.push({ id: doc.id, name: doc.name, sourceUrl: url });
  }
  await audit({ action: "ai_agent.website_imported", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "ai_agent", targetId: a.id, metadata: { url: startUrl, pages: added.length, crawl: true }, req });
  return { added, skipped: skipped.slice(0, 30) };
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
