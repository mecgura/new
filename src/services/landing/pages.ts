import { z } from "zod";
import sharp from "sharp";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { siteConfig } from "@/config/site";
import { blocksSchema, DEFAULT_THEME, parseBlocks, parseTheme, slugify, slugSchema, starter, STARTERS, themeSchema, type Block } from "@/lib/landing";
import { addContactNote, createContact, normalizePhone, recordConsent, setContactTags, updateContact, type Ctx } from "@/services/inbox/contacts";
import { isServiceEnabled } from "@/services/whatsapp/guards";

/**
 * Landing pages for a client: built from blocks in the app, published at /p/<workspace>/<slug>. Forms create or update
 * the contact in the CRM (consent recorded only when the visitor ticks the box), can open a deal, and alert the team.
 * Views, button clicks and submissions are counted with their UTM source for conversion reports.
 */

export const MAX_PAGES = 50;

export const pageUrl = (orgSlug: string, slug: string) => `${siteConfig.url}/p/${orgSlug}/${slug}`;

async function uniqueSlug(organizationId: string, base: string, exceptId?: string) {
  const root = slugify(base);
  for (let i = 0; i < 50; i++) {
    const slug = i ? `${root.slice(0, 55)}-${i + 1}` : root;
    const clash = await db.landingPage.findUnique({ where: { organizationId_slug: { organizationId, slug } }, select: { id: true } });
    if (!clash || clash.id === exceptId) return slug;
  }
  throw new ApiError("CONFLICT", "Pick a different page address.");
}

async function orgSlug(organizationId: string) {
  return (await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } })).slug;
}

function dto(p: Awaited<ReturnType<typeof db.landingPage.findFirstOrThrow>>, slugOfOrg: string) {
  const blocks = parseBlocks(p.blocks);
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    status: p.status,
    blocks,
    theme: parseTheme(p.theme),
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    noIndex: p.noIndex,
    publishedAt: p.publishedAt,
    updatedAt: p.updatedAt,
    url: pageUrl(slugOfOrg, p.slug),
    unpublishedChanges: p.status === "published" && p.blocks !== p.publishedBlocks,
  };
}
export type PageDto = ReturnType<typeof dto>;

export async function listPages(organizationId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [pages, os, views, subs] = await Promise.all([
    db.landingPage.findMany({ where: { organizationId }, orderBy: { updatedAt: "desc" } }),
    orgSlug(organizationId),
    db.landingEvent.groupBy({ by: ["pageId"], where: { organizationId, kind: "view", createdAt: { gte: since } }, _count: { _all: true } }),
    db.landingSubmission.groupBy({ by: ["pageId"], where: { organizationId, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  return pages.map((p) => {
    const v = views.find((x) => x.pageId === p.id)?._count._all ?? 0;
    const s = subs.find((x) => x.pageId === p.id)?._count._all ?? 0;
    const { blocks, ...rest } = dto(p, os);
    return { ...rest, blockCount: blocks.length, views30: v, leads30: s, conversion30: v ? Math.round((s / v) * 1000) / 10 : null };
  });
}

export async function getPage(organizationId: string, id: string) {
  const p = await db.landingPage.findFirst({ where: { id, organizationId } });
  if (!p) throw new ApiError("NOT_FOUND", "Page not found.");
  return dto(p, await orgSlug(organizationId));
}

export const createSchema = z.object({ title: z.string().trim().min(1).max(120), starter: z.enum(STARTERS.map((s) => s.id) as [string, ...string[]]).default("blank") }).strict();

export async function createPage(ctx: Ctx, input: z.infer<typeof createSchema>) {
  if ((await db.landingPage.count({ where: { organizationId: ctx.organizationId } })) >= MAX_PAGES) throw new ApiError("CONFLICT", `Up to ${MAX_PAGES} pages per workspace.`);
  const st = starter(input.starter)!;
  const acct = await db.whatsAppAccount.findFirst({ where: { organizationId: ctx.organizationId, status: { in: ["connected", "demo"] } }, orderBy: { createdAt: "asc" }, select: { phoneNumber: true } });
  const theme = { ...DEFAULT_THEME, ...st.theme, whatsapp: acct?.phoneNumber.replace(/\D/g, "") ?? "" };
  const blocks = JSON.stringify(st.blocks());
  const p = await db.landingPage.create({ data: { organizationId: ctx.organizationId, title: input.title, slug: await uniqueSlug(ctx.organizationId, input.title), blocks, theme: JSON.stringify(theme), seoTitle: input.title } });
  await audit({ action: "landing.saved", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "landing_page", targetId: p.id, metadata: { created: true, starter: input.starter }, req: ctx.req });
  return getPage(ctx.organizationId, p.id);
}

export const saveSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    slug: slugSchema,
    blocks: blocksSchema,
    theme: themeSchema,
    seoTitle: z.string().trim().max(70),
    seoDescription: z.string().trim().max(170),
    noIndex: z.boolean(),
  })
  .partial()
  .strict();

export async function savePage(ctx: Ctx, id: string, input: z.infer<typeof saveSchema>) {
  const p = await db.landingPage.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!p) throw new ApiError("NOT_FOUND", "Page not found.");
  if (input.slug && input.slug !== p.slug && (await db.landingPage.findUnique({ where: { organizationId_slug: { organizationId: ctx.organizationId, slug: input.slug } } }))) {
    throw new ApiError("CONFLICT", "Another page already uses this address.", { details: { slug: ["Already used"] } });
  }
  const ids = input.blocks?.map((b) => b.id) ?? [];
  if (new Set(ids).size !== ids.length) throw new ApiError("VALIDATION_ERROR", "Two blocks have the same id.");
  await db.landingPage.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.blocks !== undefined ? { blocks: JSON.stringify(input.blocks) } : {}),
      ...(input.theme !== undefined ? { theme: JSON.stringify(input.theme) } : {}),
      ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle } : {}),
      ...(input.seoDescription !== undefined ? { seoDescription: input.seoDescription } : {}),
      ...(input.noIndex !== undefined ? { noIndex: input.noIndex } : {}),
    },
  });
  await audit({ action: "landing.saved", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "landing_page", targetId: id, metadata: { fields: Object.keys(input) }, req: ctx.req });
  return getPage(ctx.organizationId, id);
}

/** Problems that stop a page going live (shown to the user before publishing). */
export function publishProblems(blocks: Block[], theme: z.infer<typeof themeSchema>): string[] {
  const p: string[] = [];
  if (!blocks.length) p.push("Add at least one block.");
  const needsWa = theme.floatingWhatsApp || blocks.some((b) => "action" in b && b.action === "whatsapp");
  if (needsWa && !theme.whatsapp) p.push("Add your WhatsApp number in Page settings (buttons open WhatsApp).");
  for (const b of blocks) {
    if ("link" in b && b.action === "link" && !b.link) p.push(`A “${b.type}” button is set to open a link but has none.`);
    if (b.type === "form" && !b.consentText) p.push("The lead form needs consent text (what visitors agree to).");
  }
  return p;
}

export async function setPublished(ctx: Ctx, id: string, publish: boolean) {
  const p = await db.landingPage.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!p) throw new ApiError("NOT_FOUND", "Page not found.");
  if (publish) {
    const problems = publishProblems(parseBlocks(p.blocks), parseTheme(p.theme));
    if (problems.length) throw new ApiError("VALIDATION_ERROR", problems[0], { details: { page: problems } });
  }
  await db.landingPage.update({ where: { id }, data: publish ? { status: "published", publishedBlocks: p.blocks, publishedAt: new Date() } : { status: "draft" } });
  await audit({ action: "landing.published", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "landing_page", targetId: id, metadata: { publish }, req: ctx.req });
  return getPage(ctx.organizationId, id);
}

export async function duplicatePage(ctx: Ctx, id: string) {
  const p = await db.landingPage.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!p) throw new ApiError("NOT_FOUND", "Page not found.");
  if ((await db.landingPage.count({ where: { organizationId: ctx.organizationId } })) >= MAX_PAGES) throw new ApiError("CONFLICT", `Up to ${MAX_PAGES} pages per workspace.`);
  const title = `${p.title} (copy)`.slice(0, 120);
  const copy = await db.landingPage.create({ data: { organizationId: ctx.organizationId, title, slug: await uniqueSlug(ctx.organizationId, `${p.slug}-copy`), blocks: p.blocks, theme: p.theme, seoTitle: p.seoTitle, seoDescription: p.seoDescription, noIndex: p.noIndex } });
  await audit({ action: "landing.saved", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "landing_page", targetId: copy.id, metadata: { duplicatedFrom: id }, req: ctx.req });
  return getPage(ctx.organizationId, copy.id);
}

export async function deletePage(ctx: Ctx, id: string) {
  const r = await db.landingPage.deleteMany({ where: { id, organizationId: ctx.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Page not found.");
  await audit({ action: "landing.deleted", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "landing_page", targetId: id, req: ctx.req });
}

// ---------------------------------------------------------------------------
// Images (stored as WebP, served from /api/lp-image/<id>)
// ---------------------------------------------------------------------------
export const imageSchema = z.object({ upload: z.string().max(7_000_000).regex(/^data:image\/(png|jpe?g|webp|gif);base64,/, "Upload a PNG, JPG, WebP or GIF") }).strict();

export async function uploadImage(ctx: Ctx, input: z.infer<typeof imageSchema>) {
  if ((await db.landingImage.count({ where: { organizationId: ctx.organizationId } })) >= 300) throw new ApiError("CONFLICT", "Image library is full (300). Delete unused pages first.");
  const buf = Buffer.from(input.upload.slice(input.upload.indexOf(",") + 1), "base64");
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    out = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  } catch {
    throw new ApiError("VALIDATION_ERROR", "That file isn't an image we can read.");
  }
  const img = await db.landingImage.create({ data: { organizationId: ctx.organizationId, data: new Uint8Array(out.data), width: out.info.width, height: out.info.height } });
  return { id: img.id, url: `/api/lp-image/${img.id}`, width: img.width, height: img.height };
}

export async function imageBytes(id: string) {
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return null;
  return db.landingImage.findUnique({ where: { id }, select: { data: true, mimeType: true } });
}

// ---------------------------------------------------------------------------
// Public page, tracking and form
// ---------------------------------------------------------------------------
/** A published page for visitors, or null (unknown, unpublished, or the service is off). */
export async function publicPage(orgSlugValue: string, slug: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(orgSlugValue) || !/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const org = await db.organization.findUnique({ where: { slug: orgSlugValue }, select: { id: true, name: true, slug: true } });
  if (!org || !(await isServiceEnabled(org.id, "LANDING_PAGES"))) return null;
  const p = await db.landingPage.findUnique({ where: { organizationId_slug: { organizationId: org.id, slug } } });
  if (!p || p.status !== "published") return null;
  return { id: p.id, business: org.name, title: p.title, blocks: parseBlocks(p.publishedBlocks), theme: parseTheme(p.theme), seoTitle: p.seoTitle || p.title, seoDescription: p.seoDescription, noIndex: p.noIndex, url: pageUrl(org.slug, p.slug) };
}

async function livePage(pageId: string) {
  if (!/^[a-z0-9]{10,40}$/i.test(pageId)) return null;
  const p = await db.landingPage.findUnique({ where: { id: pageId }, select: { id: true, organizationId: true, title: true, status: true, publishedBlocks: true } });
  if (!p || p.status !== "published" || !(await isServiceEnabled(p.organizationId, "LANDING_PAGES"))) return null;
  return p;
}

const utm = { utmSource: z.string().trim().max(80).default(""), utmMedium: z.string().trim().max(80).default(""), utmCampaign: z.string().trim().max(120).default("") };
export const trackSchema = z.object({ kind: z.enum(["view", "click"]), name: z.string().trim().max(30).regex(/^[a-z_]*$/).default(""), visitor: z.string().trim().max(40).regex(/^[a-z0-9]*$/i).default(""), referrer: z.string().trim().max(500).default(""), ...utm }).strict();

export async function track(pageId: string, input: z.infer<typeof trackSchema>) {
  const p = await livePage(pageId);
  if (!p) return;
  let referrerHost = "";
  try {
    referrerHost = input.referrer ? new URL(input.referrer).hostname.slice(0, 120) : "";
  } catch {
    referrerHost = "";
  }
  await db.landingEvent.create({ data: { organizationId: p.organizationId, pageId: p.id, kind: input.kind, name: input.name, visitor: input.visitor, utmSource: input.utmSource.toLowerCase(), utmMedium: input.utmMedium.toLowerCase(), utmCampaign: input.utmCampaign, referrerHost } });
}

export const submitSchema = z
  .object({
    blockId: z.string().max(24),
    name: z.string().trim().min(1, "Enter your name").max(80),
    phone: z.string().trim().min(6, "Enter your mobile number").max(20),
    email: z.string().trim().toLowerCase().email("Enter a valid email").max(200).or(z.literal("")).default(""),
    message: z.string().trim().max(1000).default(""),
    consent: z.boolean().default(false),
    /** Honeypot: real people never fill this hidden field. */
    website: z.string().max(200).default(""),
    visitor: z.string().trim().max(40).regex(/^[a-z0-9]*$/i).default(""),
    ...utm,
  })
  .strict();

/** A visitor sent the page's lead form: contact in the CRM (+ consent, tag, note, optional deal), team alerted. */
export async function submitForm(pageId: string, input: z.infer<typeof submitSchema>) {
  const p = await livePage(pageId);
  if (!p) throw new ApiError("NOT_FOUND", "This page isn't available.");
  if (input.website) return { ok: true, message: "Thank you!" }; // bot: pretend it worked, store nothing
  const form = parseBlocks(p.publishedBlocks).find((b) => b.type === "form" && b.id === input.blockId);
  if (!form || form.type !== "form") throw new ApiError("VALIDATION_ERROR", "This form isn't on the page any more. Refresh and try again.");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ApiError("VALIDATION_ERROR", "Enter a valid mobile number with country code.", { details: { phone: ["Enter a valid mobile number"] } });
  const ctx: Ctx = { organizationId: p.organizationId, actorUserId: null };
  let contactId: string | null = null;
  let created = false;
  try {
    const existing = await db.contact.findUnique({ where: { organizationId_phone: { organizationId: p.organizationId, phone } } });
    if (existing) {
      contactId = existing.id;
      await updateContact(ctx, existing.id, { ...(existing.name ? {} : { name: input.name }), ...(existing.email || !input.email ? {} : { email: input.email }) });
    } else {
      const c = await createContact(ctx, { phone, name: input.name, email: input.email, source: "landing", customFields: { landing_page: p.title.slice(0, 100), ...(input.utmSource ? { utm_source: input.utmSource } : {}), ...(input.utmCampaign ? { utm_campaign: input.utmCampaign } : {}) } });
      contactId = c.id;
      created = true;
    }
    if (form.tag) {
      const tags = (await db.contactTag.findMany({ where: { contactId }, select: { tag: { select: { name: true } } } })).map((t) => t.tag.name);
      if (!tags.includes(form.tag)) await setContactTags(ctx, contactId, [...tags, form.tag], { silent: true });
    }
    if (input.consent) await recordConsent(ctx, contactId, { status: "opted_in", source: "lead_form", evidence: `Ticked “${form.consentText.slice(0, 200)}” on ${p.title}` }, { silent: true });
    await addContactNote(ctx, contactId, `Landing page “${p.title}”${input.message ? `: ${input.message}` : ""}`).catch(() => null);
    if (form.createDeal) {
      const { createDeal } = await import("@/services/crm/deals");
      await createDeal(ctx, { contactId, title: `${input.name} – ${p.title}`.slice(0, 120), valueRupees: 0 }).catch((e) => console.error("[landing] deal not created:", e));
    }
  } catch (e) {
    // Plan contact limit or a CRM hiccup: keep the enquiry anyway so the business doesn't lose it.
    if (!(e instanceof ApiError) && !(e instanceof Prisma.PrismaClientKnownRequestError)) throw e;
    console.error("[landing] contact not saved:", e instanceof Error ? e.message : e);
  }
  await db.landingSubmission.create({ data: { organizationId: p.organizationId, pageId: p.id, contactId, data: JSON.stringify({ name: input.name, phone, email: input.email, message: input.message }), consent: input.consent, utmSource: input.utmSource.toLowerCase(), utmMedium: input.utmMedium.toLowerCase(), utmCampaign: input.utmCampaign } });
  await db.landingEvent.create({ data: { organizationId: p.organizationId, pageId: p.id, kind: "submit", name: "form", visitor: input.visitor, utmSource: input.utmSource.toLowerCase(), utmMedium: input.utmMedium.toLowerCase(), utmCampaign: input.utmCampaign } });
  const team = await db.organizationMember.findMany({ where: { organizationId: p.organizationId, role: { in: ["CLIENT_OWNER", "MANAGER"] } }, select: { userId: true } });
  for (const m of team) await notify({ userId: m.userId, type: "success", title: `New lead: ${input.name}`, body: `${p.title}${input.utmSource ? ` · from ${input.utmSource}` : ""}`, link: contactId ? `/contacts/${contactId}` : "/pages" });
  return { ok: true, message: form.successMessage || "Thank you! We'll contact you shortly.", created };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
export async function pageAnalytics(organizationId: string, id: string, days = 30, now = new Date()) {
  const p = await db.landingPage.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!p) throw new ApiError("NOT_FOUND", "Page not found.");
  const since = new Date(now.getTime() - days * 86_400_000);
  const [events, submissions] = await Promise.all([
    db.landingEvent.findMany({ where: { pageId: id, createdAt: { gte: since } }, select: { kind: true, name: true, visitor: true, utmSource: true, utmCampaign: true, referrerHost: true, createdAt: true } }),
    db.landingSubmission.findMany({ where: { pageId: id }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, contactId: true, data: true, consent: true, utmSource: true, utmCampaign: true, createdAt: true } }),
  ]);
  const views = events.filter((e) => e.kind === "view");
  const subs = events.filter((e) => e.kind === "submit");
  const visitors = new Set(views.map((v) => v.visitor).filter(Boolean)).size;
  const sourceOf = (e: { utmSource: string; referrerHost: string }) => e.utmSource || (e.referrerHost ? e.referrerHost.replace(/^www\./, "").replace(/^(l|m|lm)\.facebook\.com$/, "facebook").replace(/^l\.instagram\.com$/, "instagram") : "direct");
  const sources = [...new Set(views.map(sourceOf))].map((s) => {
    const v = views.filter((e) => sourceOf(e) === s).length;
    const l = subs.filter((e) => sourceOf(e) === s).length;
    return { source: s, views: v, leads: l, conversion: v ? Math.round((l / v) * 1000) / 10 : null };
  }).sort((a, b) => b.views - a.views);
  const clicks = events.filter((e) => e.kind === "click").reduce<Record<string, number>>((a, e) => ({ ...a, [e.name || "button"]: (a[e.name || "button"] ?? 0) + 1 }), {});
  const daily = Array.from({ length: days }, (_, i) => {
    const d = new Date(since.getTime() + (i + 1) * 86_400_000).toISOString().slice(0, 10);
    return { day: d, views: views.filter((e) => e.createdAt.toISOString().slice(0, 10) === d).length, leads: subs.filter((e) => e.createdAt.toISOString().slice(0, 10) === d).length };
  });
  return {
    views: views.length,
    visitors,
    leads: subs.length,
    conversion: views.length ? Math.round((subs.length / views.length) * 1000) / 10 : null,
    clicks,
    sources,
    daily,
    submissions: submissions.map((s) => ({ ...s, data: JSON.parse(s.data) as { name: string; phone: string; email: string; message: string } })),
  };
}
