import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { siteConfig } from "@/config/site";
import { sendSystemText, sendTemplateToContact, WINDOW_MS } from "@/services/inbox/messaging";
import { setContactTags, type Ctx } from "@/services/inbox/contacts";

/**
 * Reviews & reputation. The business sends a feedback link on WhatsApp; the customer rates 1–5 on a MECGURA page.
 * Every customer is offered the business's Google review link (Google forbids asking only happy customers), and a low
 * rating also alerts the owner and managers privately so they can fix it. Reports: average rating, trend, response
 * and Google-click rates, per location.
 */

export const reviewSettingsSchema = z
  .object({
    locations: z.array(z.object({ name: z.string().trim().min(1).max(60), reviewUrl: z.string().trim().url().max(500).refine((u) => u.startsWith("https://"), "Use an https:// link").or(z.literal("")) }).strict()).min(1).max(20),
    message: z.string().trim().min(20).max(800).refine((m) => m.includes("{link}"), "Include {link} where the feedback link goes"),
    templateId: z.string().max(40).default(""),
    lowRating: z.coerce.number().int().min(1).max(4),
    cooldownDays: z.coerce.number().int().min(0).max(365),
  })
  .strict();
export type ReviewSettings = z.infer<typeof reviewSettingsSchema>;

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  locations: [{ name: "Main", reviewUrl: "" }],
  message: "Hi {name}, thank you for choosing us! 🙏 How was your experience? It takes 10 seconds: {link}",
  templateId: "",
  lowRating: 3,
  cooldownDays: 30,
};

export async function getReviewSettings(organizationId: string): Promise<ReviewSettings> {
  const s = await db.organizationSettings.findUnique({ where: { organizationId }, select: { reviews: true } });
  if (!s?.reviews) return DEFAULT_REVIEW_SETTINGS;
  try {
    const p = reviewSettingsSchema.safeParse({ ...DEFAULT_REVIEW_SETTINGS, ...(JSON.parse(s.reviews) as object) });
    return p.success ? p.data : DEFAULT_REVIEW_SETTINGS;
  } catch {
    return DEFAULT_REVIEW_SETTINGS;
  }
}

export async function saveReviewSettings(ctx: Ctx, input: ReviewSettings) {
  if (new Set(input.locations.map((l) => l.name.toLowerCase())).size !== input.locations.length) throw new ApiError("VALIDATION_ERROR", "Location names must be different.", { details: { locations: ["Duplicate name"] } });
  if (input.templateId && !(await db.messageTemplate.count({ where: { id: input.templateId, organizationId: ctx.organizationId } }))) throw new ApiError("VALIDATION_ERROR", "Pick one of your templates.", { details: { templateId: ["Unknown template"] } });
  const json = JSON.stringify(input);
  await db.organizationSettings.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, reviews: json }, update: { reviews: json } });
  await audit({ action: "reviews.settings_changed", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "reviews", req: ctx.req });
  return getReviewSettings(ctx.organizationId);
}

export const feedbackUrl = (token: string) => `${siteConfig.url}/f/${token}`;
const firstName = (n: string) => n.trim().split(/\s+/)[0] || "there";

export const sendSchema = z
  .object({
    contactIds: z.array(z.string().min(1).max(40)).min(1).max(200),
    location: z.string().trim().max(60).default(""),
    /** Only make the links (for sending by hand); nothing goes out on WhatsApp. */
    linkOnly: z.boolean().default(false),
  })
  .strict();

type SendResult = { contactId: string; name: string; status: "sent" | "failed" | "link" | "skipped"; reason?: string; link?: string };

/**
 * Creates one feedback link per customer and sends it: a normal message when their 24-hour window is open, otherwise
 * the approved template chosen in settings ({{1}} = first name, {{2}} = link, or a URL button ending in the code).
 * Customers asked within the cooldown, opted out or suppressed are skipped.
 */
export async function sendRequests(ctx: Ctx, input: z.infer<typeof sendSchema>) {
  const s = await getReviewSettings(ctx.organizationId);
  const location = input.location || s.locations[0].name;
  if (!s.locations.some((l) => l.name === location)) throw new ApiError("VALIDATION_ERROR", "Pick one of your locations.", { details: { location: ["Unknown location"] } });
  const contacts = await db.contact.findMany({ where: { organizationId: ctx.organizationId, id: { in: input.contactIds } }, include: { conversations: { where: { whatsappAccountId: { not: null } }, orderBy: { lastInboundAt: { sort: "desc", nulls: "last" } }, take: 1 } } });
  if (contacts.length !== new Set(input.contactIds).size) throw new ApiError("VALIDATION_ERROR", "Some contacts aren't in this workspace.", { details: { contactIds: ["Unknown contact"] } });
  const since = new Date(Date.now() - s.cooldownDays * 86_400_000);
  const recent = new Set((await db.reviewRequest.findMany({ where: { organizationId: ctx.organizationId, contactId: { in: input.contactIds }, sentAt: { gte: since }, status: { not: "failed" } }, select: { contactId: true } })).map((r) => r.contactId));
  const fallbackAcct = await db.whatsAppAccount.findFirst({ where: { organizationId: ctx.organizationId, status: { in: ["connected", "demo"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const results: SendResult[] = [];
  for (const c of contacts) {
    const name = c.name || c.phone;
    if (s.cooldownDays && recent.has(c.id)) {
      results.push({ contactId: c.id, name, status: "skipped", reason: `Asked in the last ${s.cooldownDays} days` });
      continue;
    }
    if (!input.linkOnly && (c.optInStatus === "opted_out" || c.suppressed)) {
      results.push({ contactId: c.id, name, status: "skipped", reason: "Opted out" });
      continue;
    }
    const token = randomBytes(12).toString("base64url");
    const link = feedbackUrl(token);
    const req = await db.reviewRequest.create({ data: { organizationId: ctx.organizationId, contactId: c.id, token, location, status: "sent", channel: "link", actorId: ctx.actorUserId } });
    if (input.linkOnly) {
      results.push({ contactId: c.id, name, status: "link", link });
      continue;
    }
    const conv = c.conversations[0];
    const windowOpen = Boolean(conv?.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < WINDOW_MS);
    try {
      if (windowOpen && conv) {
        await sendSystemText(ctx.organizationId, conv.id, s.message.replaceAll("{name}", firstName(c.name)).replaceAll("{link}", link), { reviewRequestId: req.id });
        await db.reviewRequest.update({ where: { id: req.id }, data: { channel: "session" } });
      } else if (s.templateId) {
        const acct = conv?.whatsappAccountId ?? fallbackAcct?.id;
        if (!acct) throw new Error("No WhatsApp number is connected.");
        const t = await db.messageTemplate.findFirst({ where: { id: s.templateId, organizationId: ctx.organizationId }, select: { body: true, buttons: true } });
        const values: Record<string, string> = { "body.1": firstName(c.name) };
        if (t && /\{\{2\}\}/.test(t.body)) values["body.2"] = link;
        if (t) (JSON.parse(t.buttons || "[]") as { type: string; url?: string }[]).forEach((b, i) => {
          if (b.type === "URL" && /\{\{1\}\}/.test(b.url ?? "")) values[`button.${i}`] = token;
        });
        await sendTemplateToContact(ctx.organizationId, acct, c.id, s.templateId, values, { reviewRequestId: req.id });
        await db.reviewRequest.update({ where: { id: req.id }, data: { channel: "template" } });
      } else {
        throw new Error("Their 24-hour window is closed. Choose an approved template in Reviews → Settings, or copy the link and send it yourself.");
      }
      results.push({ contactId: c.id, name, status: "sent", link });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Sending failed.";
      await db.reviewRequest.update({ where: { id: req.id }, data: { status: "failed", error: reason.slice(0, 300) } });
      results.push({ contactId: c.id, name, status: "failed", reason, link });
    }
  }
  await audit({ action: "reviews.requested", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "review_request", metadata: { asked: input.contactIds.length, sent: results.filter((r) => r.status === "sent").length, linkOnly: input.linkOnly }, req: ctx.req });
  return { results };
}

// ---------------------------------------------------------------------------
// Public feedback page
// ---------------------------------------------------------------------------
async function byToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16}$/.test(token)) return null;
  return db.reviewRequest.findUnique({ where: { token }, include: { organization: { select: { name: true } }, contact: { select: { name: true } } } });
}

/** What the customer sees when they open their link (marks it opened). */
export async function openFeedback(token: string) {
  const r = await byToken(token);
  if (!r) return null;
  if (!r.openedAt) await db.reviewRequest.update({ where: { id: r.id }, data: { openedAt: new Date(), ...(r.status === "sent" ? { status: "opened" } : {}) } });
  const s = await getReviewSettings(r.organizationId);
  return { business: r.organization.name, firstName: firstName(r.contact.name), rated: r.rating, reviewUrl: s.locations.find((l) => l.name === r.location)?.reviewUrl || s.locations[0]?.reviewUrl || "" };
}

export const rateSchema = z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(1000).default("") }).strict();

/** The customer's rating. A low one alerts the team privately; everyone is offered the public review link. */
export async function submitFeedback(token: string, input: z.infer<typeof rateSchema>) {
  const r = await byToken(token);
  if (!r) throw new ApiError("NOT_FOUND", "This feedback link isn't valid.");
  if (r.rating) throw new ApiError("CONFLICT", "Thanks, we already have your feedback.");
  const s = await getReviewSettings(r.organizationId);
  const low = input.rating <= s.lowRating;
  await db.reviewRequest.update({ where: { id: r.id }, data: { rating: input.rating, comment: input.comment, status: "rated", ratedAt: new Date(), openedAt: r.openedAt ?? new Date(), escalated: low } });
  if (low) {
    const team = await db.organizationMember.findMany({ where: { organizationId: r.organizationId, role: { in: ["CLIENT_OWNER", "MANAGER"] } }, select: { userId: true } });
    for (const m of team) await notify({ userId: m.userId, type: "warning", title: `${input.rating}★ feedback from ${r.contact.name || "a customer"}`, body: input.comment ? input.comment.slice(0, 160) : "No comment. Call them to sort it out.", link: "/reviews?tab=feedback" });
    await setContactTags({ organizationId: r.organizationId, actorUserId: null }, r.contactId, [...(await db.contactTag.findMany({ where: { contactId: r.contactId }, select: { tag: { select: { name: true } } } })).map((t) => t.tag.name), "Unhappy customer"], { silent: true }).catch(() => null);
  }
  return { low, reviewUrl: s.locations.find((l) => l.name === r.location)?.reviewUrl || s.locations[0]?.reviewUrl || "" };
}

export async function googleClicked(token: string) {
  const r = await byToken(token);
  if (r && !r.googleClickedAt) await db.reviewRequest.update({ where: { id: r.id }, data: { googleClickedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Team views
// ---------------------------------------------------------------------------
export const listSchema = z.object({ filter: z.enum(["all", "rated", "unhappy", "open", "failed"]).default("all"), location: z.string().trim().max(60).optional() });

export async function listRequests(organizationId: string, q: z.infer<typeof listSchema>) {
  const where = {
    organizationId,
    ...(q.location ? { location: q.location } : {}),
    ...(q.filter === "rated" ? { rating: { not: null } } : q.filter === "unhappy" ? { escalated: true } : q.filter === "open" ? { escalated: true, resolvedAt: null } : q.filter === "failed" ? { status: "failed" } : {}),
  };
  const rows = await db.reviewRequest.findMany({ where, include: { contact: { select: { id: true, name: true, phone: true } } }, orderBy: { sentAt: "desc" }, take: 300 });
  return rows.map(({ token, ...r }) => ({ ...r, link: feedbackUrl(token) }));
}

export const resolveSchema = z.object({ note: z.string().trim().min(3, "Say what was done").max(500) }).strict();

export async function resolveFeedback(ctx: Ctx, id: string, input: z.infer<typeof resolveSchema>) {
  const r = await db.reviewRequest.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!r) throw new ApiError("NOT_FOUND", "Feedback not found.");
  if (!r.escalated) throw new ApiError("CONFLICT", "Only unhappy feedback needs resolving.");
  await db.reviewRequest.update({ where: { id }, data: { resolvedAt: new Date(), resolvedNote: input.note } });
  await audit({ action: "reviews.resolved", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "review_request", targetId: id, req: ctx.req });
}

/** Rating report: averages, distribution, rates, 8-week trend and each location. */
export async function reviewStats(organizationId: string, now = new Date()) {
  const since = new Date(now.getTime() - 56 * 86_400_000);
  const rows = await db.reviewRequest.findMany({ where: { organizationId, sentAt: { gte: since } }, select: { status: true, rating: true, location: true, sentAt: true, openedAt: true, googleClickedAt: true, escalated: true, resolvedAt: true } });
  const delivered = rows.filter((r) => r.status !== "failed");
  const rated = rows.filter((r) => r.rating);
  const avg = (xs: { rating: number | null }[]) => (xs.length ? Math.round((xs.reduce((a, r) => a + (r.rating ?? 0), 0) / xs.length) * 10) / 10 : null);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = new Date(now.getTime() - (7 - i) * 7 * 86_400_000);
    const start = new Date(end.getTime() - 7 * 86_400_000);
    const w = rated.filter((r) => r.sentAt > start && r.sentAt <= end);
    return { weekEnding: end.toISOString().slice(0, 10), average: avg(w), count: w.length };
  });
  const locations = [...new Set(rows.map((r) => r.location))].map((name) => {
    const l = rows.filter((r) => r.location === name);
    const lr = l.filter((r) => r.rating);
    return { name: name || "—", sent: l.length, rated: lr.length, average: avg(lr), unhappy: l.filter((r) => r.escalated).length };
  });
  return {
    sent: rows.length,
    failed: rows.length - delivered.length,
    openRate: pct(delivered.filter((r) => r.openedAt).length, delivered.length),
    responseRate: pct(rated.length, delivered.length),
    average: avg(rated),
    distribution: [5, 4, 3, 2, 1].map((star) => ({ star, count: rated.filter((r) => r.rating === star).length })),
    googleClickRate: pct(rated.filter((r) => r.googleClickedAt).length, rated.length),
    openIssues: (await db.reviewRequest.count({ where: { organizationId, escalated: true, resolvedAt: null } })),
    weeks,
    locations,
  };
}
