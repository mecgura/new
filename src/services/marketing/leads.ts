import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { normalizePhone } from "@/services/inbox/contacts";
import { SOURCES, SOURCE_LABELS, STAGES, STAGE_LABELS, type Source, type Stage } from "@/lib/marketing";

export { SOURCES, SOURCE_LABELS, STAGES, STAGE_LABELS, followUpText, type Source, type Stage } from "@/lib/marketing";

/**
 * MECGURA's own sales pipeline (Super Admin only). Leads arrive by themselves from the website chat, the MECGURA
 * WhatsApp number and tracked links, or are added by hand. One row per phone number: a person who comes back is
 * the same lead with a "seen again" note, not a duplicate.
 */
const text = (max: number) => z.string().trim().max(max).default("");
export const attributionSchema = z.object({ medium: text(60), campaign: text(80), ref: z.string().trim().max(60).regex(/^[a-z0-9-]*$/i).default("") });

export const newLeadSchema = z
  .object({
    name: text(80),
    phone: z.string().trim().min(5).max(20),
    email: z.string().trim().toLowerCase().email().max(200).or(z.literal("")).default(""),
    business: text(120),
    city: text(60),
    source: z.enum(SOURCES).default("manual"),
    note: text(1000),
    valueRupees: z.coerce.number().min(0).max(10_000_000).default(0),
    website: z.string().trim().max(300).default(""),
    placeId: z.string().trim().max(300).default(""),
  })
  .merge(attributionSchema)
  .strict();

export const updateLeadSchema = z
  .object({
    name: z.string().trim().max(80),
    email: z.string().trim().toLowerCase().email().max(200).or(z.literal("")),
    business: z.string().trim().max(120),
    city: z.string().trim().max(60),
    stage: z.enum(STAGES),
    valueRupees: z.coerce.number().min(0).max(10_000_000),
    lostReason: z.string().trim().max(200),
    nextFollowUpAt: z.string().datetime({ offset: true }).or(z.literal("")),
    note: z.string().trim().min(1).max(1000),
  })
  .partial()
  .strict();

type LeadRow = Awaited<ReturnType<typeof db.marketingLead.findFirstOrThrow>>;

/** 0–100: how much this lead deserves attention right now. Hot leads are fresh, warm-sourced and moving. */
export function heatScore(l: Pick<LeadRow, "source" | "stage" | "createdAt" | "lastContactAt" | "nextFollowUpAt">, now = Date.now()): number {
  if (l.stage === "won") return 100;
  if (l.stage === "lost") return 0;
  const base: Record<string, number> = { referral: 35, whatsapp: 30, website_form: 30, website_chat: 25, festival: 25, demo_click: 20, maps: 12, manual: 10 };
  let s = base[l.source] ?? 10;
  const ageDays = (now - l.createdAt.getTime()) / 86_400_000;
  s += ageDays < 2 ? 25 : ageDays < 7 ? 15 : ageDays < 30 ? 5 : 0;
  s += l.stage === "proposal" ? 30 : l.stage === "demo" ? 22 : l.stage === "contacted" ? 8 : 0;
  // Waiting for a call-back: never contacted, or the follow-up date has passed.
  if (!l.lastContactAt || (l.nextFollowUpAt && l.nextFollowUpAt.getTime() <= now)) s += 10;
  return Math.max(1, Math.min(99, Math.round(s)));
}
export const heatLabel = (score: number) => (score >= 60 ? "hot" : score >= 35 ? "warm" : "cold");

async function admins() {
  return (await db.user.findMany({ where: { role: "SUPER_ADMIN", status: "active" }, select: { id: true } })).map((u) => u.id);
}

/**
 * Adds a lead, or notes that a known one came back. Used by the website chat, the MECGURA WhatsApp number, the
 * demo form and the admin's "Add lead". Returns the lead and whether it was new.
 */
export async function recordLead(input: z.input<typeof newLeadSchema>, actorId: string | null = null, req?: Request) {
  const v = newLeadSchema.parse(input);
  const phone = normalizePhone(v.phone);
  if (!phone) throw new ApiError("VALIDATION_ERROR", "Enter a valid mobile number.", { details: { phone: ["Enter a valid mobile number"] } });
  const existing = await db.marketingLead.findUnique({ where: { phone } });
  if (existing) {
    const reopened = existing.stage === "lost";
    await db.marketingLead.update({
      where: { id: existing.id },
      data: {
        name: existing.name || v.name,
        email: existing.email || v.email,
        business: existing.business || v.business,
        city: existing.city || v.city,
        website: existing.website || v.website,
        placeId: existing.placeId || v.placeId,
        ...(reopened ? { stage: "new", lostReason: "" } : {}),
      },
    });
    await db.marketingLeadActivity.create({
      data: { leadId: existing.id, kind: "seen_again", actorId, text: `Came back via ${SOURCE_LABELS[v.source]}${reopened ? " (reopened)" : ""}${v.note ? `: ${v.note}` : ""}` },
    });
    return { lead: await getLead(existing.id), created: false };
  }
  const lead = await db.marketingLead.create({
    data: {
      phone,
      name: v.name,
      email: v.email,
      business: v.business,
      city: v.city,
      source: v.source,
      website: v.website,
      placeId: v.placeId,
      medium: v.medium,
      campaign: v.campaign,
      ref: v.ref.toLowerCase(),
      valuePaise: Math.round(v.valueRupees * 100),
      activities: { create: [{ kind: "created", actorId, text: `New lead from ${SOURCE_LABELS[v.source]}${v.medium ? ` (${v.medium}${v.campaign ? ` · ${v.campaign}` : ""})` : ""}` }, ...(v.note ? [{ kind: "note", actorId, text: v.note }] : [])] },
    },
  });
  await audit({ action: "marketing.lead_saved", actorUserId: actorId ?? undefined, targetType: "marketing_lead", targetId: lead.id, metadata: { source: v.source, created: true }, req });
  if (!actorId) {
    for (const userId of await admins()) await notify({ userId, type: "success", title: `New lead: ${v.name || phone}`, body: `${SOURCE_LABELS[v.source]}${v.business ? ` · ${v.business}` : ""}`, link: `/admin/marketing?tab=leads&lead=${lead.id}` });
  }
  return { lead: await getLead(lead.id), created: true };
}

/** Best effort: capture paths call this so a marketing hiccup never breaks the chat or WhatsApp reply. */
export async function recordLeadQuietly(input: z.input<typeof newLeadSchema>) {
  try {
    return await recordLead(input);
  } catch (e) {
    console.error("[marketing] lead not recorded:", e instanceof Error ? e.message : e);
    return null;
  }
}

function dto(l: LeadRow & { activities?: { id: string; kind: string; text: string; createdAt: Date }[] }) {
  const score = heatScore(l);
  return { ...l, valueRupees: l.valuePaise / 100, heat: score, heatLabel: heatLabel(score), activities: l.activities ?? [] };
}
export type LeadDto = ReturnType<typeof dto>;

export async function getLead(id: string) {
  const l = await db.marketingLead.findUnique({ where: { id }, include: { activities: { orderBy: { createdAt: "desc" }, take: 50 } } });
  if (!l) throw new ApiError("NOT_FOUND", "Lead not found.");
  return dto(l);
}

export const listQuerySchema = z.object({ q: z.string().trim().max(80).optional(), stage: z.enum(STAGES).optional(), source: z.enum(SOURCES).optional() });

export async function listLeads(q: z.infer<typeof listQuerySchema> = {}) {
  const term = q.q?.trim();
  const rows = await db.marketingLead.findMany({
    where: {
      ...(q.stage ? { stage: q.stage } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(term ? { OR: [{ name: { contains: term } }, { phone: { contains: term } }, { business: { contains: term } }, { city: { contains: term } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return rows.map((r) => dto(r)).sort((a, b) => b.heat - a.heat);
}

/** Who to call today: follow-ups that are due and fresh leads nobody has contacted yet, hottest first. */
export async function todayQueue(now = new Date()) {
  const endOfDay = new Date(now);
  endOfDay.setUTCHours(18, 29, 59, 999); // 23:59 India time
  if (endOfDay < now) endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
  const rows = await db.marketingLead.findMany({
    where: { stage: { notIn: ["won", "lost"] }, OR: [{ nextFollowUpAt: { lte: endOfDay } }, { lastContactAt: null }] },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((r) => ({ ...dto(r), overdue: Boolean(r.nextFollowUpAt && r.nextFollowUpAt < now) })).sort((a, b) => b.heat - a.heat);
}

export async function updateLead(id: string, patch: z.infer<typeof updateLeadSchema>, actorId: string, req?: Request) {
  const l = await db.marketingLead.findUnique({ where: { id } });
  if (!l) throw new ApiError("NOT_FOUND", "Lead not found.");
  const { note, valueRupees, nextFollowUpAt, ...rest } = patch;
  const data: Record<string, unknown> = { ...rest };
  if (valueRupees !== undefined) data.valuePaise = Math.round(valueRupees * 100);
  if (nextFollowUpAt !== undefined) data.nextFollowUpAt = nextFollowUpAt ? new Date(nextFollowUpAt) : null;
  if (patch.stage && patch.stage !== "lost") data.lostReason = "";
  const acts: { kind: string; text: string }[] = [];
  if (patch.stage && patch.stage !== l.stage) acts.push({ kind: "stage", text: `${STAGE_LABELS[l.stage as Stage] ?? l.stage} → ${STAGE_LABELS[patch.stage]}${patch.stage === "lost" && patch.lostReason ? ` (${patch.lostReason})` : ""}` });
  if (nextFollowUpAt) acts.push({ kind: "follow_up", text: `Follow-up set for ${new Date(nextFollowUpAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}` });
  if (note) acts.push({ kind: "note", text: note });
  await db.marketingLead.update({ where: { id }, data: { ...data, ...(acts.length ? { activities: { create: acts.map((a) => ({ ...a, actorId })) } } : {}) } });
  await audit({ action: "marketing.lead_saved", actorUserId: actorId, targetType: "marketing_lead", targetId: id, metadata: { fields: Object.keys(patch) }, req });
  return getLead(id);
}

/** The admin opened WhatsApp for this lead: counts as contact, and a brand-new lead moves to "Contacted". */
export async function markContacted(id: string, actorId: string) {
  const l = await db.marketingLead.findUnique({ where: { id } });
  if (!l) throw new ApiError("NOT_FOUND", "Lead not found.");
  await db.marketingLead.update({
    where: { id },
    data: { lastContactAt: new Date(), ...(l.stage === "new" ? { stage: "contacted" } : {}), activities: { create: { kind: "whatsapp", actorId, text: "Messaged on WhatsApp" } } },
  });
  return getLead(id);
}

export async function deleteLead(id: string, actorId: string, req?: Request) {
  const r = await db.marketingLead.deleteMany({ where: { id } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Lead not found.");
  await audit({ action: "marketing.lead_saved", actorUserId: actorId, targetType: "marketing_lead", targetId: id, metadata: { deleted: true }, req });
}

/** When a client workspace is created for a number that was a lead, the lead is won and linked to it. */
export async function linkClientToLead(phone: string, organizationId: string, valuePaise = 0) {
  const p = normalizePhone(phone);
  if (!p) return;
  const l = await db.marketingLead.findUnique({ where: { phone: p } });
  if (!l) return;
  await db.marketingLead.update({
    where: { id: l.id },
    data: { stage: "won", organizationId, lostReason: "", ...(valuePaise && !l.valuePaise ? { valuePaise } : {}), activities: { create: { kind: "stage", text: `${STAGE_LABELS[l.stage as Stage] ?? l.stage} → Won (onboarded as a client)` } } },
  });
}
