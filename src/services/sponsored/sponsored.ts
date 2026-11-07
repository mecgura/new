import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { SponsoredAd } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { siteConfig } from "@/config/site";
import { getSetting, setSetting } from "@/lib/settings";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { normalizePhone } from "@/services/inbox/contacts";
import type { OrgAccess } from "@/lib/session";

/**
 * Sponsored placements: a client's ad card in the labelled "Sponsored" side panel on MECGURA's own website (blog).
 * The client writes it, Super Admin reviews it, and only reviewed ads are ever served. Every card says "Sponsored".
 */

export const MAX_IMAGE_BYTES = 1024 * 1024;
const ENABLED_KEY = "site:sponsored_enabled";
const PANEL_SIZE = 2;

export const STATUSES = ["draft", "pending", "active", "paused", "rejected", "ended"] as const;
export type AdStatus = (typeof STATUSES)[number];

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const isoDate = z
  .string()
  .trim()
  .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "Use a valid date")
  .default("");

export const adSchema = z
  .object({
    name: z.string().trim().min(2, "Give it a name").max(60),
    headline: z.string().trim().min(5, "Write a headline (5+ characters)").max(60, "Headline: up to 60 characters"),
    body: z.string().trim().max(140, "Description: up to 140 characters").default(""),
    ctaLabel: z.string().trim().min(2).max(24, "Button text: up to 24 characters").default("Learn more"),
    linkType: z.enum(["url", "whatsapp"]).default("url"),
    link: z.string().trim().min(1, "Add the link or WhatsApp number").max(500),
    waMessage: z.string().trim().max(140).default(""),
    /** A data URL (JPG / PNG / WebP, up to 1 MB). Leave out to keep the current image; "" removes it. */
    image: z.string().max(1_600_000).optional(),
    startsAt: isoDate,
    endsAt: isoDate,
  })
  .strict();
export type AdInput = z.infer<typeof adSchema>;

export const adActionSchema = z.object({ action: z.enum(["submit", "pause", "resume"]) }).strict();
export const reviewSchema = z
  .object({
    action: z.enum(["approve", "reject", "pause", "resume", "end", "save"]),
    note: z.string().trim().max(300).default(""),
    maxImpressions: z.number().int().min(0).max(10_000_000).optional(),
    startsAt: isoDate.optional(),
    endsAt: isoDate.optional(),
  })
  .strict();

/** https URL only (no credentials, no bare IPs / localhost), or a valid WhatsApp number. Returns what to store. */
export function normalizeLink(linkType: "url" | "whatsapp", raw: string): string {
  if (linkType === "whatsapp") {
    const p = normalizePhone(raw);
    if (!p) throw new ApiError("VALIDATION_ERROR", "Enter a valid WhatsApp number.", { details: { link: ["Invalid number"] } });
    return p.slice(1);
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Enter a full link starting with https://", { details: { link: ["Invalid link"] } });
  }
  const host = u.hostname.toLowerCase();
  const bad = u.protocol !== "https:" || u.username || u.password || !host.includes(".") || /^\d+(\.\d+){3}$/.test(host) || host === "localhost" || host.endsWith(".local");
  if (bad) throw new ApiError("VALIDATION_ERROR", "Use a public https:// link (for example your website or Google Maps page).", { details: { link: ["Use a public https link"] } });
  return u.toString();
}

export const destinationOf = (ad: Pick<SponsoredAd, "linkType" | "link" | "waMessage">) =>
  ad.linkType === "whatsapp" ? `https://wa.me/${ad.link}${ad.waMessage ? `?text=${encodeURIComponent(ad.waMessage)}` : ""}` : ad.link;

function sniffImage(b: Buffer) {
  if (b.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}
function decodeImage(data: string) {
  const bytes = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
  const mime = sniffImage(bytes);
  if (!mime) throw new ApiError("VALIDATION_ERROR", "Upload a JPG, PNG or WebP image.", { details: { image: ["Unsupported image"] } });
  if (bytes.length > MAX_IMAGE_BYTES) throw new ApiError("VALIDATION_ERROR", "Image up to 1 MB. Compress it (e.g. tinypng.com) and try again.", { details: { image: ["Too large"] } });
  return { bytes, mime };
}
const toDate = (s: string | undefined) => (s ? new Date(s) : null);

// ---------------------------------------------------------------------------
// Phase (what the ad is doing right now) and views
// ---------------------------------------------------------------------------

export type Phase = "draft" | "pending" | "rejected" | "paused" | "scheduled" | "live" | "ended";

export function phaseOf(ad: Pick<SponsoredAd, "status" | "startsAt" | "endsAt" | "maxImpressions" | "impressions">, now = new Date()): Phase {
  if (ad.status === "draft" || ad.status === "pending" || ad.status === "rejected" || ad.status === "paused") return ad.status;
  if (ad.status === "ended") return "ended";
  if (ad.endsAt && ad.endsAt < now) return "ended";
  if (ad.maxImpressions > 0 && ad.impressions >= ad.maxImpressions) return "ended";
  if (ad.startsAt && ad.startsAt > now) return "scheduled";
  return "live";
}

const imageUrl = (ad: Pick<SponsoredAd, "imageKey" | "updatedAt">) => (ad.imageKey ? `/api/sponsored-img/${ad.imageKey}?v=${ad.updatedAt.getTime()}` : null);
const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);

function dto(ad: SponsoredAd & { organization?: { name: string } }) {
  return {
    id: ad.id,
    name: ad.name,
    headline: ad.headline,
    body: ad.body,
    ctaLabel: ad.ctaLabel,
    linkType: ad.linkType as "url" | "whatsapp",
    link: ad.link,
    waMessage: ad.waMessage,
    imageUrl: imageUrl(ad),
    status: ad.status as AdStatus,
    phase: phaseOf(ad),
    reviewNote: ad.reviewNote,
    startsAt: ad.startsAt?.toISOString() ?? null,
    endsAt: ad.endsAt?.toISOString() ?? null,
    maxImpressions: ad.maxImpressions,
    impressions: ad.impressions,
    clicks: ad.clicks,
    ctr: ad.impressions ? Math.round((ad.clicks / ad.impressions) * 1000) / 10 : 0,
    organizationId: ad.organizationId,
    advertiser: ad.organization?.name,
    createdAt: ad.createdAt.toISOString(),
    updatedAt: ad.updatedAt.toISOString(),
  };
}
export type SponsoredAdDto = ReturnType<typeof dto>;

// ---------------------------------------------------------------------------
// Client side
// ---------------------------------------------------------------------------

async function mine(access: OrgAccess, id: string) {
  const ad = await db.sponsoredAd.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!ad) throw new ApiError("NOT_FOUND", "Ad not found.");
  return ad;
}

export async function listMine(organizationId: string) {
  await assertServiceEnabled(organizationId, "SPONSORED_ADS");
  const rows = await db.sponsoredAd.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map(dto);
}

export async function createAd(access: OrgAccess, input: AdInput, req?: Request) {
  await assertServiceEnabled(access.organizationId, "SPONSORED_ADS");
  if ((await db.sponsoredAd.count({ where: { organizationId: access.organizationId } })) >= 50) throw new ApiError("CONFLICT", "You have 50 ads already. Delete the old ones first.");
  const link = normalizeLink(input.linkType, input.link);
  checkDates(input.startsAt, input.endsAt);
  const img = input.image ? decodeImage(input.image) : null;
  const ad = await db.sponsoredAd.create({
    data: {
      organizationId: access.organizationId,
      name: input.name,
      headline: input.headline,
      body: input.body,
      ctaLabel: input.ctaLabel,
      linkType: input.linkType,
      link,
      waMessage: input.linkType === "whatsapp" ? input.waMessage : "",
      startsAt: toDate(input.startsAt),
      endsAt: toDate(input.endsAt),
      ...(img ? { imageKey: randomBytes(18).toString("base64url"), imageMime: img.mime, imageBytes: img.bytes } : {}),
    },
  });
  await audit({ action: "sponsored.created", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "sponsored_ad", targetId: ad.id, req });
  return dto(ad);
}

function checkDates(startsAt: string, endsAt: string) {
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) throw new ApiError("VALIDATION_ERROR", "The end date must be after the start date.", { details: { endsAt: ["Must be after the start"] } });
}

export async function updateAd(access: OrgAccess, id: string, input: AdInput, req?: Request) {
  await assertServiceEnabled(access.organizationId, "SPONSORED_ADS");
  const cur = await mine(access, id);
  const link = normalizeLink(input.linkType, input.link);
  checkDates(input.startsAt, input.endsAt);
  const img = input.image ? decodeImage(input.image) : null;
  const changedContent =
    cur.headline !== input.headline || cur.body !== input.body || cur.ctaLabel !== input.ctaLabel || cur.link !== link || cur.linkType !== input.linkType || cur.waMessage !== (input.linkType === "whatsapp" ? input.waMessage : "") || Boolean(img) || input.image === "";
  // A rejected ad becomes a draft again; changing what people see on a live / paused / waiting ad sends it back to review.
  const status: AdStatus = cur.status === "rejected" ? "draft" : changedContent && ["active", "paused", "pending"].includes(cur.status) ? "pending" : (cur.status as AdStatus);
  const ad = await db.sponsoredAd.update({
    where: { id },
    data: {
      name: input.name,
      headline: input.headline,
      body: input.body,
      ctaLabel: input.ctaLabel,
      linkType: input.linkType,
      link,
      waMessage: input.linkType === "whatsapp" ? input.waMessage : "",
      startsAt: toDate(input.startsAt),
      endsAt: toDate(input.endsAt),
      status,
      ...(status !== cur.status && status === "draft" ? { reviewNote: "" } : {}),
      ...(img ? { imageKey: cur.imageKey ?? randomBytes(18).toString("base64url"), imageMime: img.mime, imageBytes: img.bytes } : input.image === "" ? { imageKey: null, imageMime: "", imageBytes: null } : {}),
    },
  });
  await audit({ action: "sponsored.updated", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "sponsored_ad", targetId: id, metadata: { sentBackToReview: status === "pending" && cur.status !== "pending" }, req });
  return dto(ad);
}

export async function adAction(access: OrgAccess, id: string, action: "submit" | "pause" | "resume", req?: Request) {
  await assertServiceEnabled(access.organizationId, "SPONSORED_ADS");
  const cur = await mine(access, id);
  let status: AdStatus;
  if (action === "submit") {
    if (cur.status !== "draft" && cur.status !== "rejected") throw new ApiError("CONFLICT", "Only a draft can be sent for review.");
    status = "pending";
  } else if (action === "pause") {
    if (cur.status !== "active") throw new ApiError("CONFLICT", "Only a live ad can be paused.");
    status = "paused";
  } else {
    if (cur.status !== "paused" || cur.reviewNote.startsWith("Paused by MECGURA")) throw new ApiError("CONFLICT", cur.status === "paused" ? "MECGURA paused this ad. Contact us to resume it." : "Only a paused ad can be resumed.");
    status = "active";
  }
  const ad = await db.sponsoredAd.update({ where: { id }, data: { status } });
  await audit({ action: "sponsored.updated", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "sponsored_ad", targetId: id, metadata: { action }, req });
  return dto(ad);
}

export async function deleteAd(access: OrgAccess, id: string, req?: Request) {
  await assertServiceEnabled(access.organizationId, "SPONSORED_ADS");
  await mine(access, id);
  await db.sponsoredAd.delete({ where: { id } });
  await audit({ action: "sponsored.deleted", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "sponsored_ad", targetId: id, req });
}

/** Last 14 days for one ad (the owner's own). */
export async function adReport(organizationId: string, id: string) {
  const ad = await db.sponsoredAd.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!ad) throw new ApiError("NOT_FOUND", "Ad not found.");
  return dailyStats(id);
}

async function dailyStats(adId: string) {
  const rows = await db.sponsoredStat.findMany({ where: { adId }, orderBy: { day: "desc" }, take: 14 });
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: { day: string; impressions: number; clicks: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = day(new Date(Date.now() - i * 86_400_000));
    out.push({ day: d, impressions: map.get(d)?.impressions ?? 0, clicks: map.get(d)?.clicks ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Super Admin
// ---------------------------------------------------------------------------

export async function adminList(status?: string) {
  const rows = await db.sponsoredAd.findMany({ where: status && (STATUSES as readonly string[]).includes(status) ? { status } : {}, include: { organization: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }], take: 200 });
  const counts = await db.sponsoredAd.groupBy({ by: ["status"], _count: { _all: true } });
  return { ads: rows.map(dto), counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>, enabled: await panelEnabled() };
}

export async function adminReview(adminId: string, id: string, input: z.infer<typeof reviewSchema>, req?: Request) {
  const cur = await db.sponsoredAd.findUnique({ where: { id } });
  if (!cur) throw new ApiError("NOT_FOUND", "Ad not found.");
  const data: Record<string, unknown> = {};
  switch (input.action) {
    case "approve":
      if (cur.status !== "pending" && cur.status !== "paused" && cur.status !== "ended") throw new ApiError("CONFLICT", "Only a pending ad can be approved.");
      Object.assign(data, { status: "active", reviewNote: input.note, reviewedAt: new Date() });
      break;
    case "reject":
      if (cur.status === "draft") throw new ApiError("CONFLICT", "The client hasn't sent this ad for review yet.");
      if (!input.note) throw new ApiError("VALIDATION_ERROR", "Tell the client why (they'll see this).", { details: { note: ["Add a reason"] } });
      Object.assign(data, { status: "rejected", reviewNote: input.note, reviewedAt: new Date() });
      break;
    case "pause":
      Object.assign(data, { status: "paused", reviewNote: input.note ? `Paused by MECGURA: ${input.note}` : "Paused by MECGURA" });
      break;
    case "resume":
      if (cur.status !== "paused") throw new ApiError("CONFLICT", "Only a paused ad can be resumed.");
      Object.assign(data, { status: "active", reviewNote: "" });
      break;
    case "end":
      Object.assign(data, { status: "ended" });
      break;
    case "save":
      break;
  }
  if (input.maxImpressions !== undefined) data.maxImpressions = input.maxImpressions;
  if (input.startsAt !== undefined) data.startsAt = toDate(input.startsAt);
  if (input.endsAt !== undefined) data.endsAt = toDate(input.endsAt);
  const ad = await db.sponsoredAd.update({ where: { id }, data, include: { organization: { select: { name: true } } } });
  await audit({ action: "sponsored.reviewed", organizationId: cur.organizationId, actorUserId: adminId, targetType: "sponsored_ad", targetId: id, metadata: { decision: input.action, note: input.note || undefined }, req });
  return { ad: dto(ad), daily: await dailyStats(id) };
}

export async function adminDaily(id: string) {
  return dailyStats(id);
}

export const panelEnabled = async () => (await getSetting(ENABLED_KEY, "1")) !== "0";
export async function setPanelEnabled(adminId: string, enabled: boolean, req?: Request) {
  await setSetting(ENABLED_KEY, enabled ? "1" : "0");
  await audit({ action: "sponsored.reviewed", actorUserId: adminId, targetType: "sponsored_panel", metadata: { enabled }, req });
}

// ---------------------------------------------------------------------------
// Public: what the website shows
// ---------------------------------------------------------------------------

function liveWhere(now: Date) {
  return {
    status: "active",
    AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
  };
}

/** Cheap check used when the page is built: is there anything to show? */
export async function hasLiveAds(): Promise<boolean> {
  try {
    if (!(await panelEnabled())) return false;
    const rows = await db.sponsoredAd.findMany({ where: liveWhere(new Date()), select: { maxImpressions: true, impressions: true }, take: 20 });
    return rows.some((r) => r.maxImpressions === 0 || r.impressions < r.maxImpressions);
  } catch {
    return false;
  }
}

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|headless|lighthouse|monitor/i;

/** The ads for the panel (fewest views first, so every paying client gets a fair turn). Counts one view for each. */
export async function serveAds(opts: { userAgent: string; countViews: boolean }) {
  if (!(await panelEnabled())) return [];
  const now = new Date();
  const rows = await db.sponsoredAd.findMany({ where: liveWhere(now), include: { organization: { select: { name: true } } }, take: 50 });
  const live = rows.filter((a) => a.maxImpressions === 0 || a.impressions < a.maxImpressions);
  const picked = live
    .map((a) => ({ a, k: a.impressions + Math.random() * 3 }))
    .sort((x, y) => x.k - y.k)
    .slice(0, PANEL_SIZE)
    .map((x) => x.a);
  if (opts.countViews && !BOT.test(opts.userAgent)) {
    const d = day(now);
    for (const a of picked) {
      await db.sponsoredAd.update({ where: { id: a.id }, data: { impressions: { increment: 1 }, ...(a.maxImpressions > 0 && a.impressions + 1 >= a.maxImpressions ? { status: "ended" } : {}) } }).catch(() => null);
      await db.sponsoredStat.upsert({ where: { adId_day: { adId: a.id, day: d } }, update: { impressions: { increment: 1 } }, create: { adId: a.id, day: d, impressions: 1 } }).catch(() => null);
    }
  }
  return picked.map((a) => ({
    id: a.id,
    headline: a.headline,
    body: a.body,
    ctaLabel: a.ctaLabel,
    advertiser: a.organization.name,
    imageUrl: imageUrl(a),
    href: `/api/sponsored/${a.id}/click`,
  }));
}

/** Counts a click and returns where to send the visitor. Only ads that are live can be clicked through. */
export async function recordClick(id: string, userAgent: string, count: boolean) {
  const ad = await db.sponsoredAd.findFirst({ where: { id, ...liveWhere(new Date()) } });
  if (!ad) return null;
  if (count && !BOT.test(userAgent)) {
    await db.sponsoredAd.update({ where: { id }, data: { clicks: { increment: 1 } } }).catch(() => null);
    const d = day(new Date());
    await db.sponsoredStat.upsert({ where: { adId_day: { adId: id, day: d } }, update: { clicks: { increment: 1 } }, create: { adId: id, day: d, clicks: 1 } }).catch(() => null);
  }
  return destinationOf(ad);
}

export async function adImage(key: string) {
  if (!/^[\w-]{20,40}$/.test(key)) return null;
  const ad = await db.sponsoredAd.findUnique({ where: { imageKey: key }, select: { imageBytes: true, imageMime: true } });
  return ad?.imageBytes ? { bytes: ad.imageBytes, mime: ad.imageMime } : null;
}

export const advertiseHref = `https://wa.me/${siteConfig.contact.whatsapp}?text=${encodeURIComponent("Hi MECGURA, I want to advertise my business in the Sponsored section on mecgura.tech.")}`;
