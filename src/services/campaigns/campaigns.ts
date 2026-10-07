import { randomUUID } from "node:crypto";
import { incrementUsage } from "@/lib/services/usage";
import { assertBillingActive, assertFeature, assertMonthlyQuota } from "@/services/billing/entitlements";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime/broker";
import type { OrgAccess } from "@/lib/session";
import type { Audience, VariableMapping } from "@/lib/validations";
import { applyStatusUpdate, receiveInbound } from "@/services/inbox/messaging";
import { getTemplate } from "@/services/templates/templates";
import { assertTagsInOrg, parseAudience, previewAudience } from "@/services/campaigns/audience";
import { runCompliance, type ComplianceReport } from "@/services/campaigns/compliance";

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "paused", "completed", "cancelled", "failed"] as const;
const MIN_LEAD_MS = 2 * 60 * 1000;
const MAX_LEAD_MS = 60 * 24 * 60 * 60 * 1000;

const include = {
  template: { select: { id: true, name: true, language: true, category: true, status: true, qualityScore: true } },
  whatsappAccount: { select: { id: true, displayName: true, phoneNumber: true, status: true, isDemo: true } },
  segment: { select: { id: true, name: true } },
  createdBy: { select: { name: true, email: true } },
} satisfies Prisma.CampaignInclude;
type Row = Prisma.CampaignGetPayload<{ include: typeof include }>;

export type CampaignStats = { total: number; queued: number; sent: number; delivered: number; read: number; failed: number; skipped: number; replies: number; optOuts: number };
const EMPTY: CampaignStats = { total: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, replies: 0, optOuts: 0 };

/** Live counters from recipient rows (never drifting stored totals). */
export async function campaignStats(ids: string[]): Promise<Map<string, CampaignStats>> {
  const out = new Map(ids.map((id) => [id, { ...EMPTY }]));
  if (!ids.length) return out;
  const where = { campaignId: { in: ids } };
  const by = (extra: Prisma.CampaignRecipientWhereInput) => db.campaignRecipient.groupBy({ by: ["campaignId"], where: { ...where, ...extra }, _count: { _all: true } });
  const [statuses, sent, delivered, read, replies, optOuts] = await Promise.all([
    db.campaignRecipient.groupBy({ by: ["campaignId", "status"], where, _count: { _all: true } }),
    by({ sentAt: { not: null } }),
    by({ deliveredAt: { not: null } }),
    by({ readAt: { not: null } }),
    by({ repliedAt: { not: null } }),
    by({ optedOutAt: { not: null } }),
  ]);
  for (const g of statuses) {
    const s = out.get(g.campaignId)!;
    s.total += g._count._all;
    if (g.status === "queued" || g.status === "sending") s.queued += g._count._all;
    if (g.status === "failed") s.failed += g._count._all;
    if (g.status === "skipped") s.skipped += g._count._all;
  }
  for (const [list, key] of [[sent, "sent"], [delivered, "delivered"], [read, "read"], [replies, "replies"], [optOuts, "optOuts"]] as const) {
    for (const g of list) out.get(g.campaignId)![key] = g._count._all;
  }
  return out;
}

function toDto(c: Row, stats: CampaignStats) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.status,
    statusReason: c.statusReason,
    step: c.step,
    isDemo: c.isDemo,
    account: c.whatsappAccount,
    template: c.template,
    segment: c.segment,
    audience: parseAudience(c.audience),
    variables: JSON.parse(c.variables || "{}") as Record<string, VariableMapping>,
    scheduledAt: c.scheduledAt,
    review: c.reviewedAt ? (JSON.parse(c.review) as ComplianceReport) : null,
    reviewedAt: c.reviewedAt,
    totalRecipients: c.totalRecipients,
    createdBy: c.createdBy?.name || c.createdBy?.email || null,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    stats,
  };
}
export type CampaignDto = ReturnType<typeof toDto>;

async function load(organizationId: string, id: string) {
  const c = await db.campaign.findFirst({ where: { id, organizationId }, include });
  if (!c) throw new ApiError("NOT_FOUND", "Campaign not found.");
  return c;
}

export async function getCampaign(access: OrgAccess, id: string) {
  const c = await load(access.organizationId, id);
  return toDto(c, (await campaignStats([id])).get(id)!);
}

/** For server-rendered pages that already resolved the tenant. Null when not in this org. */
export async function findCampaign(organizationId: string, id: string) {
  const c = await db.campaign.findFirst({ where: { id, organizationId }, include });
  return c ? toDto(c, (await campaignStats([id])).get(id)!) : null;
}

export async function listCampaigns(access: OrgAccess, f: { status?: string; q?: string }) {
  const base: Prisma.CampaignWhereInput = { organizationId: access.organizationId, ...(f.q ? { name: { contains: f.q } } : {}) };
  const [rows, grouped] = await Promise.all([
    db.campaign.findMany({ where: { ...base, ...(f.status ? { status: f.status } : {}) }, include, orderBy: { updatedAt: "desc" }, take: 200 }),
    db.campaign.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);
  const stats = await campaignStats(rows.map((r) => r.id));
  const counts: Record<string, number> = { all: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.all += g._count._all;
  }
  return { campaigns: rows.map((r) => toDto(r, stats.get(r.id)!)), counts };
}

async function assertAccount(organizationId: string, id: string) {
  const a = await db.whatsAppAccount.findFirst({ where: { id, organizationId, status: { in: ["connected", "demo"] } } });
  if (!a) throw new ApiError("VALIDATION_ERROR", "Choose a connected WhatsApp number.", { details: { whatsappAccountId: ["Not connected"] } });
  return a;
}

export async function createCampaign(access: OrgAccess, input: { name: string; description: string; whatsappAccountId: string }, req?: Request) {
  await assertFeature(access.organizationId, "campaigns");
  const a = await assertAccount(access.organizationId, input.whatsappAccountId);
  const c = await db.campaign.create({
    data: { organizationId: access.organizationId, name: input.name, description: input.description, whatsappAccountId: a.id, isDemo: a.isDemo, createdById: access.user.id, step: 2 },
  });
  await audit({ action: "campaign.created", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "campaign", targetId: c.id, metadata: { name: c.name, demo: a.isDemo }, req });
  return getCampaign(access, c.id);
}

export type CampaignPatch = Partial<{
  name: string;
  description: string;
  whatsappAccountId: string;
  templateId: string | null;
  audience: Audience;
  variables: Record<string, VariableMapping>;
  scheduledAt: Date | null;
  step: number;
}>;

/** Saves wizard progress. Anything that changes who/what gets sent invalidates the last compliance review. */
export async function updateCampaign(access: OrgAccess, id: string, p: CampaignPatch, req?: Request) {
  const c = await load(access.organizationId, id);
  if (c.status !== "draft") throw new ApiError("CONFLICT", "Only draft campaigns can be edited.");
  const data: Prisma.CampaignUncheckedUpdateInput = {};
  if (p.name !== undefined) data.name = p.name;
  if (p.description !== undefined) data.description = p.description;
  if (p.whatsappAccountId !== undefined) {
    const a = await assertAccount(access.organizationId, p.whatsappAccountId);
    data.whatsappAccountId = a.id;
    data.isDemo = a.isDemo;
    // A template only works on its own WhatsApp account — drop it when the sender moves to another account.
    const current = c.templateId ? await db.messageTemplate.findUnique({ where: { id: c.templateId }, select: { wabaRecordId: true } }) : null;
    if (current && current.wabaRecordId !== a.wabaRecordId && p.templateId === undefined) {
      data.templateId = null;
      data.variables = "{}";
    }
  }
  if (p.templateId !== undefined) {
    if (p.templateId) {
      const t = await db.messageTemplate.findFirst({ where: { id: p.templateId, organizationId: access.organizationId } });
      if (!t) throw new ApiError("VALIDATION_ERROR", "Template not found.", { details: { templateId: ["Unknown template"] } });
      if (t.category === "AUTHENTICATION") throw new ApiError("VALIDATION_ERROR", "Authentication templates can't be used in campaigns.", { details: { templateId: ["Not allowed"] } });
      if (t.status !== "approved") throw new ApiError("VALIDATION_ERROR", "Choose an approved template.", { details: { templateId: [`Template is ${t.status}`] } });
      const acct = await db.whatsAppAccount.findUnique({ where: { id: (data.whatsappAccountId as string | undefined) ?? c.whatsappAccountId ?? "" } });
      if (acct && acct.wabaRecordId !== t.wabaRecordId) throw new ApiError("VALIDATION_ERROR", "This template belongs to a different WhatsApp account than the sending number.", { details: { templateId: ["Different account"] } });
      if (p.templateId !== c.templateId) data.variables = "{}";
    }
    data.templateId = p.templateId;
  }
  if (p.audience !== undefined) {
    const a = p.audience;
    if (a.mode === "segment") {
      const seg = a.segmentId ? await db.segment.findFirst({ where: { id: a.segmentId, organizationId: access.organizationId } }) : null;
      if (!seg) throw new ApiError("VALIDATION_ERROR", "Choose a saved segment.", { details: { segmentId: ["Unknown segment"] } });
    }
    if (a.mode === "filters") await assertTagsInOrg(access.organizationId, [...a.filters.tagIds, ...a.filters.excludeTagIds]);
    data.audience = JSON.stringify(a);
    data.segmentId = a.mode === "segment" ? a.segmentId : null;
  }
  if (p.variables !== undefined) data.variables = JSON.stringify(p.variables);
  if (p.scheduledAt !== undefined) {
    if (p.scheduledAt) {
      const lead = p.scheduledAt.getTime() - Date.now();
      if (lead < MIN_LEAD_MS) throw new ApiError("VALIDATION_ERROR", "Pick a time at least 2 minutes from now, or send now.", { details: { scheduledAt: ["Too soon"] } });
      if (lead > MAX_LEAD_MS) throw new ApiError("VALIDATION_ERROR", "Campaigns can be scheduled up to 60 days ahead.", { details: { scheduledAt: ["Too far ahead"] } });
    }
    data.scheduledAt = p.scheduledAt;
  }
  if (p.step !== undefined) data.step = Math.max(c.step, p.step);
  if (p.templateId !== undefined || p.audience !== undefined || p.variables !== undefined || p.whatsappAccountId !== undefined) {
    data.reviewedAt = null;
    data.review = "{}";
  }
  await db.campaign.update({ where: { id }, data });
  if (p.name !== undefined || p.description !== undefined) {
    await audit({ action: "campaign.updated", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "campaign", targetId: id, metadata: { name: p.name }, req });
  }
  return getCampaign(access, id);
}

export async function deleteCampaign(access: OrgAccess, id: string, req?: Request) {
  const c = await load(access.organizationId, id);
  if (c.status !== "draft") throw new ApiError("CONFLICT", "Only drafts can be deleted. Cancel a scheduled or running campaign instead — its history is kept.");
  await db.campaign.delete({ where: { id } });
  await audit({ action: "campaign.cancelled", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "campaign", targetId: id, metadata: { name: c.name, deletedDraft: true }, req });
}

export async function audiencePreview(access: OrgAccess, audience: Audience) {
  return previewAudience(access.organizationId, audience);
}

/** Step 6. Stores the report so the team can see exactly what was checked before sending. */
export async function reviewCampaign(access: OrgAccess, id: string, req?: Request) {
  const c = await load(access.organizationId, id);
  if (c.status !== "draft") throw new ApiError("CONFLICT", "This campaign was already launched.");
  await assertFeature(access.organizationId, "campaigns");
  await assertBillingActive(access.organizationId);
  await assertMonthlyQuota(access.organizationId, "campaigns", 1, "campaigns");
  const { report } = await runCompliance(id);
  await db.campaign.update({ where: { id }, data: { review: JSON.stringify(report), reviewedAt: new Date(), step: Math.max(c.step, 6) } });
  await audit({
    action: "campaign.reviewed",
    organizationId: access.organizationId,
    actorUserId: access.user.id,
    targetType: "campaign",
    targetId: id,
    metadata: { total: report.total, eligible: report.eligible, removed: report.removed, canSend: report.canSend },
    req,
  });
  return report;
}

/**
 * Step 7. Re-runs compliance on fresh data (contacts may have opted out since
 * the review), freezes the recipient list, then schedules or starts sending.
 */
export async function launchCampaign(access: OrgAccess, id: string, req?: Request) {
  const c = await load(access.organizationId, id);
  if (c.status !== "draft") throw new ApiError("CONFLICT", "This campaign was already launched.");
  if (!c.reviewedAt) throw new ApiError("CONFLICT", "Run the compliance review before sending.");
  const { report, recipients } = await runCompliance(id);
  if (!report.canSend) {
    await db.campaign.update({ where: { id }, data: { review: JSON.stringify(report), reviewedAt: new Date() } });
    throw new ApiError("CONFLICT", "Compliance review failed — fix the blocking items before sending.", { details: { review: report.checks.filter((x) => x.status === "fail").map((x) => `${x.label}: ${x.detail}`) } });
  }
  const scheduled = c.scheduledAt && c.scheduledAt.getTime() > Date.now();
  if (c.scheduledAt && !scheduled) throw new ApiError("CONFLICT", "The scheduled time has passed. Pick a new time or choose “Send now”.");

  // Status flips first (guarded), so a double click can't create recipients twice.
  const flipped = await db.campaign.updateMany({
    where: { id, status: "draft" },
    data: {
      status: scheduled ? "scheduled" : "sending",
      review: JSON.stringify(report),
      reviewedAt: new Date(),
      totalRecipients: recipients.length,
      step: 7,
      statusReason: "",
      ...(scheduled ? {} : { startedAt: new Date() }),
    },
  });
  if (!flipped.count) throw new ApiError("CONFLICT", "This campaign was already launched.");
  await incrementUsage(c.organizationId, "campaigns_launched");
  for (let i = 0; i < recipients.length; i += 500) {
    await db.campaignRecipient.createMany({
      data: recipients.slice(i, i + 500).map((r) => ({ organizationId: c.organizationId, campaignId: id, contactId: r.contactId, phone: r.phone, name: r.name, variables: JSON.stringify(r.values) })),
    });
  }
  await audit({
    action: scheduled ? "campaign.scheduled" : "campaign.started",
    organizationId: access.organizationId,
    actorUserId: access.user.id,
    targetType: "campaign",
    targetId: id,
    metadata: { recipients: recipients.length, removed: report.removed, scheduledAt: c.scheduledAt?.toISOString(), consentConfirmed: true },
    req,
  });
  publish(c.organizationId, { type: "campaign.updated", campaignId: id });
  return { campaign: await getCampaign(access, id), report, startNow: !scheduled };
}

export async function campaignAction(access: OrgAccess, id: string, action: "pause" | "resume" | "cancel", req?: Request) {
  const r = await applyAction(access, id, action, req);
  publish(access.organizationId, { type: "campaign.updated", campaignId: id });
  return r;
}

async function applyAction(access: OrgAccess, id: string, action: "pause" | "resume" | "cancel", req?: Request) {
  const c = await load(access.organizationId, id);
  if (action === "pause") {
    const r = await db.campaign.updateMany({ where: { id, status: { in: ["sending", "scheduled"] } }, data: { status: "paused", statusReason: "Paused by a team member." } });
    if (!r.count) throw new ApiError("CONFLICT", "Only scheduled or sending campaigns can be paused.");
    await audit({ action: "campaign.paused", organizationId: c.organizationId, actorUserId: access.user.id, targetType: "campaign", targetId: id, req });
  } else if (action === "resume") {
    if (c.status !== "paused") throw new ApiError("CONFLICT", "Only paused campaigns can be resumed.");
    if (c.template?.status !== "approved") throw new ApiError("CONFLICT", "The template is no longer approved, so this campaign can't resume.");
    const future = c.scheduledAt && c.scheduledAt.getTime() > Date.now();
    await db.campaign.update({ where: { id }, data: { status: future ? "scheduled" : "sending", statusReason: "", ...(future || c.startedAt ? {} : { startedAt: new Date() }) } });
    await audit({ action: future ? "campaign.scheduled" : "campaign.started", organizationId: c.organizationId, actorUserId: access.user.id, targetType: "campaign", targetId: id, metadata: { resumed: true }, req });
    return { campaign: await getCampaign(access, id), startNow: !future };
  } else {
    if (!["scheduled", "sending", "paused"].includes(c.status)) throw new ApiError("CONFLICT", c.status === "draft" ? "Delete the draft instead." : "This campaign has already finished.");
    await db.campaign.update({ where: { id }, data: { status: "cancelled", statusReason: "Cancelled by a team member.", completedAt: new Date() } });
    await db.campaignRecipient.updateMany({ where: { campaignId: id, status: "queued" }, data: { status: "skipped", error: "Campaign cancelled." } });
    await audit({ action: "campaign.cancelled", organizationId: c.organizationId, actorUserId: access.user.id, targetType: "campaign", targetId: id, req });
  }
  return { campaign: await getCampaign(access, id), startNow: false };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export type Signal = { level: "ok" | "info" | "warn" | "danger"; title: string; detail: string };

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export async function campaignAnalytics(access: OrgAccess, id: string, opts: { status?: string; page?: number } = {}) {
  const c = await load(access.organizationId, id);
  const stats = (await campaignStats([id])).get(id)!;
  const [errors, acct, template] = await Promise.all([
    db.campaignRecipient.groupBy({ by: ["error"], where: { campaignId: id, status: { in: ["failed", "skipped"] }, error: { not: "" } }, _count: { _all: true }, orderBy: { _count: { error: "desc" } }, take: 5 }),
    c.whatsappAccountId ? db.whatsAppAccount.findUnique({ where: { id: c.whatsappAccountId }, include: { phone: true } }) : null,
    c.templateId ? db.messageTemplate.findUnique({ where: { id: c.templateId }, select: { name: true, qualityScore: true, status: true } }) : null,
  ]);

  const rates = {
    delivered: pct(stats.delivered, stats.sent),
    read: pct(stats.read, stats.sent),
    failed: pct(stats.failed, stats.sent + stats.failed),
    replies: pct(stats.replies, stats.delivered),
    optOuts: pct(stats.optOuts, stats.delivered),
  };

  const signals: Signal[] = [];
  const attempted = stats.sent + stats.failed;
  if (attempted >= 10 && rates.failed >= 25) signals.push({ level: "danger", title: "High failure rate", detail: `${rates.failed}% of messages failed. Check the errors below before sending again.` });
  else if (attempted >= 10 && rates.failed >= 10) signals.push({ level: "warn", title: "Elevated failure rate", detail: `${rates.failed}% of messages failed.` });
  if (stats.delivered >= 20 && rates.optOuts >= 5) signals.push({ level: "danger", title: "Many opt-outs", detail: `${rates.optOuts}% of reached customers opted out. This hurts your quality rating — tighten the audience and content.` });
  else if (stats.delivered >= 20 && rates.optOuts >= 2) signals.push({ level: "warn", title: "Opt-outs above 2%", detail: `${rates.optOuts}% opted out. Keep an eye on your quality rating.` });
  if (stats.delivered >= 50 && rates.read < 20) signals.push({ level: "info", title: "Low read rate", detail: `Only ${rates.read}% read the message. Try a better time or more relevant audience.` });
  if (template?.qualityScore === "RED") signals.push({ level: "danger", title: "Template quality: low", detail: `Meta rates “${template.name}” low quality. It may be paused.` });
  else if (template?.qualityScore === "YELLOW") signals.push({ level: "warn", title: "Template quality: medium", detail: `Meta rates “${template.name}” medium quality.` });
  else if (template?.qualityScore === "GREEN") signals.push({ level: "ok", title: "Template quality: high", detail: `Meta rates “${template.name}” high quality.` });
  if (template && template.status !== "approved") signals.push({ level: "danger", title: `Template ${template.status}`, detail: "Meta changed the template status; sending stops automatically." });
  const q = acct?.phone?.qualityRating;
  if (q === "RED" || q === "YELLOW") signals.push({ level: q === "RED" ? "danger" : "warn", title: `Number quality: ${q === "RED" ? "low" : "medium"}`, detail: `${acct?.displayName} — reported by Meta.` });
  else if (q === "GREEN") signals.push({ level: "ok", title: "Number quality: high", detail: `${acct?.displayName} — reported by Meta.` });
  if (acct?.phone?.messagingLimitTier) signals.push({ level: "info", title: "Messaging limit", detail: `${acct.phone.messagingLimitTier.replace("TIER_", "")} business-initiated conversations per 24 h.` });
  if (c.isDemo) signals.push({ level: "info", title: "Demo campaign", detail: "Sent through the demo number — nothing reached real customers. Quality signals from Meta appear for live numbers only." });

  const PAGE = 50;
  const page = Math.max(1, opts.page ?? 1);
  const rWhere: Prisma.CampaignRecipientWhereInput = {
    campaignId: id,
    ...(opts.status === "replied" ? { repliedAt: { not: null } } : opts.status === "opted_out" ? { optedOutAt: { not: null } } : opts.status ? { status: opts.status } : {}),
  };
  const [recipients, recipientTotal] = await Promise.all([
    db.campaignRecipient.findMany({ where: rWhere, orderBy: { createdAt: "asc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.campaignRecipient.count({ where: rWhere }),
  ]);
  return {
    stats,
    rates,
    signals,
    errors: errors.map((e) => ({ error: e.error, count: e._count._all })),
    recipients: recipients.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      name: r.name,
      phone: r.phone,
      status: r.status,
      error: r.error,
      sentAt: r.sentAt,
      deliveredAt: r.deliveredAt,
      readAt: r.readAt,
      repliedAt: r.repliedAt,
      optedOutAt: r.optedOutAt,
    })),
    recipientTotal,
    page,
    pageSize: PAGE,
  };
}

export async function campaignTemplate(access: OrgAccess, id: string) {
  const c = await load(access.organizationId, id);
  return c.templateId ? getTemplate(access, c.templateId) : null;
}

// ---------------------------------------------------------------------------
// Demo simulator — runs real delivery receipts / inbound messages through the
// same code paths a live webhook uses, on demo campaigns only.
// ---------------------------------------------------------------------------

const DEMO_REPLIES = ["Yes, interested!", "Please share more details", "What's the price?", "Thank you", "Is this available in my city?"];

export async function simulateCampaignOutcomes(access: OrgAccess, id: string, n: { delivered: number; read: number; failed: number; replies: number; optOuts: number }) {
  const c = await load(access.organizationId, id);
  if (!c.isDemo) throw new ApiError("FORBIDDEN", "Outcomes come from Meta for live campaigns.");
  if (!c.whatsappAccountId) throw new ApiError("CONFLICT", "The campaign has no sending number.");
  const rows = await db.campaignRecipient.findMany({ where: { campaignId: id, messageId: { not: null } }, include: { message: { select: { externalId: true } } }, orderBy: { createdAt: "asc" } });
  const apply = async (status: string, pick: (r: (typeof rows)[number]) => boolean, count: number) => {
    let done = 0;
    for (const r of rows) {
      if (done >= count) break;
      const fresh = await db.campaignRecipient.findUniqueOrThrow({ where: { id: r.id } });
      if (!pick({ ...r, ...fresh }) || !r.message?.externalId) continue;
      await applyStatusUpdate(c.organizationId, r.message.externalId, status, status === "failed" ? "(demo) Message undeliverable" : "");
      done++;
    }
    return done;
  };
  const failed = await apply("failed", (r) => r.status === "sent", n.failed);
  const delivered = await apply("delivered", (r) => r.status === "sent", n.delivered);
  const read = await apply("read", (r) => r.status === "delivered", n.read);

  const inbound = async (text: (i: number) => string, pick: (r: (typeof rows)[number]) => boolean, count: number, list: typeof rows) => {
    let done = 0;
    for (const r of list) {
      if (done >= count) break;
      const fresh = await db.campaignRecipient.findUniqueOrThrow({ where: { id: r.id } });
      if (!pick({ ...r, ...fresh }) || !r.message?.externalId) continue;
      await receiveInbound(c.organizationId, c.whatsappAccountId!, {
        externalId: `demo.in.${randomUUID()}`,
        fromPhone: r.phone,
        profileName: r.name,
        type: "text",
        body: text(done),
        replyToExternalId: r.message.externalId,
        at: new Date(),
        isDemo: true,
      });
      done++;
    }
    return done;
  };
  const reached = (r: (typeof rows)[number]) => r.status !== "failed" && r.status !== "skipped";
  // Opt-outs come from the end of the list and replies from the start, so the two don't compete for the same customers.
  const optOuts = await inbound(() => "STOP", (r) => reached(r) && !r.optedOutAt && !r.repliedAt, n.optOuts, [...rows].reverse());
  const replies = await inbound((i) => DEMO_REPLIES[i % DEMO_REPLIES.length], (r) => reached(r) && !r.repliedAt && !r.optedOutAt, n.replies, rows);
  return { applied: { failed, delivered, read, replies, optOuts }, campaign: await getCampaign(access, id) };
}
