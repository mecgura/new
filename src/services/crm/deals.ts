import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { parseScoring, scoreContact, scoringSchema, type ScoringConfig } from "@/lib/lead-scoring";
import { updateContact, type Ctx } from "@/services/inbox/contacts";

/**
 * Sales pipeline for a client workspace: their own stages (with a win probability each), deals linked to contacts,
 * a Kanban board, forecast and per-salesperson numbers. Winning a deal marks the contact a customer.
 */

export const STAGE_COLORS = ["slate", "sky", "violet", "amber", "orange", "emerald", "rose"] as const;
export const STAGE_KINDS = ["open", "won", "lost"] as const;

const DEFAULT_STAGES = [
  { name: "New", color: "slate", probability: 10, kind: "open" },
  { name: "Contacted", color: "sky", probability: 20, kind: "open" },
  { name: "Qualified", color: "violet", probability: 40, kind: "open" },
  { name: "Proposal sent", color: "amber", probability: 60, kind: "open" },
  { name: "Negotiation", color: "orange", probability: 80, kind: "open" },
  { name: "Won", color: "emerald", probability: 100, kind: "won" },
  { name: "Lost", color: "rose", probability: 0, kind: "lost" },
] as const;

/** Stages in order; a workspace without any gets the default pipeline the first time it's opened. */
export async function getStages(organizationId: string) {
  const rows = await db.pipelineStage.findMany({ where: { organizationId }, orderBy: { position: "asc" } });
  if (rows.length) return rows;
  // One row at a time: if two requests open the board together, the unique (workspace, position) key stops doubles.
  for (const [i, s] of DEFAULT_STAGES.entries()) await db.pipelineStage.create({ data: { ...s, organizationId, position: i } }).catch(() => null);
  return db.pipelineStage.findMany({ where: { organizationId }, orderBy: { position: "asc" } });
}

export const stagesSchema = z
  .object({
    stages: z
      .array(
        z
          .object({
            id: z.string().max(40).optional(),
            name: z.string().trim().min(1, "Name the stage").max(40),
            color: z.enum(STAGE_COLORS),
            probability: z.coerce.number().int().min(0).max(100),
            kind: z.enum(STAGE_KINDS),
          })
          .strict()
      )
      .min(3)
      .max(15),
  })
  .strict()
  .superRefine((v, ctx) => {
    const count = (k: string) => v.stages.filter((s) => s.kind === k).length;
    if (!count("open")) ctx.addIssue({ code: "custom", message: "Keep at least one open stage.", path: ["stages"] });
    if (count("won") !== 1) ctx.addIssue({ code: "custom", message: "Have exactly one Won stage.", path: ["stages"] });
    if (count("lost") !== 1) ctx.addIssue({ code: "custom", message: "Have exactly one Lost stage.", path: ["stages"] });
  });

/** Saves the stage list in the given order. A removed stage must be empty first. */
export async function saveStages(ctx: Ctx, input: z.infer<typeof stagesSchema>) {
  const existing = await getStages(ctx.organizationId);
  const keep = new Set(input.stages.map((s) => s.id).filter(Boolean));
  for (const s of input.stages) if (s.id && !existing.some((e) => e.id === s.id)) throw new ApiError("NOT_FOUND", "Stage not found.");
  const removed = existing.filter((e) => !keep.has(e.id));
  if (removed.length) {
    const used = await db.deal.count({ where: { organizationId: ctx.organizationId, stageId: { in: removed.map((r) => r.id) } } });
    if (used) throw new ApiError("CONFLICT", `Move the ${used} deal${used === 1 ? "" : "s"} out of ${removed.map((r) => `“${r.name}”`).join(", ")} before removing it.`);
  }
  await db.$transaction(async (tx) => {
    if (removed.length) await tx.pipelineStage.deleteMany({ where: { organizationId: ctx.organizationId, id: { in: removed.map((r) => r.id) } } });
    // Park kept stages on high positions first so reordering never clashes with the unique position key.
    for (const [i, s] of input.stages.entries()) if (s.id) await tx.pipelineStage.update({ where: { id: s.id }, data: { position: 1000 + i } });
    for (const [i, s] of input.stages.entries()) {
      const data = { name: s.name, color: s.color, probability: s.kind === "won" ? 100 : s.kind === "lost" ? 0 : s.probability, kind: s.kind, position: i };
      if (s.id) {
        await tx.pipelineStage.update({ where: { id: s.id }, data });
        // A stage switched between open/won/lost carries its deals with it.
        await tx.deal.updateMany({ where: { organizationId: ctx.organizationId, stageId: s.id, status: { not: s.kind } }, data: { status: s.kind, closedAt: s.kind === "open" ? null : new Date() } });
      } else await tx.pipelineStage.create({ data: { ...data, organizationId: ctx.organizationId } });
    }
  });
  await audit({ action: "pipeline.updated", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "pipeline", metadata: { stages: input.stages.length }, req: ctx.req });
  return getStages(ctx.organizationId);
}

// ---------------------------------------------------------------------------
// Lead scoring settings
// ---------------------------------------------------------------------------
export async function getScoring(organizationId: string): Promise<ScoringConfig> {
  const s = await db.organizationSettings.findUnique({ where: { organizationId }, select: { leadScoring: true } });
  return parseScoring(s?.leadScoring);
}

export async function saveScoring(ctx: Ctx, input: z.infer<typeof scoringSchema>) {
  const json = JSON.stringify(input);
  await db.organizationSettings.upsert({ where: { organizationId: ctx.organizationId }, create: { organizationId: ctx.organizationId, leadScoring: json }, update: { leadScoring: json } });
  await audit({ action: "pipeline.updated", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "lead_scoring", metadata: { rules: input.rules.length }, req: ctx.req });
  return getScoring(ctx.organizationId);
}

/** Scores for a set of contacts in one go (tags, status, last message and open deal value). */
export async function scoreContacts(organizationId: string, contactIds: string[], cfg?: ScoringConfig) {
  const config = cfg ?? (await getScoring(organizationId));
  if (!contactIds.length) return new Map<string, ReturnType<typeof scoreContact>>();
  const [contacts, open] = await Promise.all([
    db.contact.findMany({ where: { organizationId, id: { in: contactIds } }, select: { id: true, leadStatus: true, source: true, optInStatus: true, email: true, lastInboundAt: true, tags: { select: { tag: { select: { name: true } } } } } }),
    db.deal.groupBy({ by: ["contactId"], where: { organizationId, contactId: { in: contactIds }, status: "open" }, _sum: { valuePaise: true } }),
  ]);
  const dealSum = new Map(open.map((d) => [d.contactId, d._sum.valuePaise ?? 0]));
  return new Map(contacts.map((c) => [c.id, scoreContact({ tags: c.tags.map((t) => t.tag.name), leadStatus: c.leadStatus, source: c.source, optInStatus: c.optInStatus, email: c.email, lastInboundAt: c.lastInboundAt, openDealPaise: dealSum.get(c.id) ?? 0 }, config)]));
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------
const rupees = z.coerce.number().min(0).max(1_000_000_000);
const dateOrEmpty = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).or(z.literal(""));

export const createDealSchema = z
  .object({
    contactId: z.string().min(1).max(40),
    title: z.string().trim().min(1, "Give the deal a name").max(120),
    valueRupees: rupees.default(0),
    stageId: z.string().max(40).optional(),
    ownerUserId: z.string().max(40).nullable().optional(),
    expectedCloseAt: dateOrEmpty.optional(),
  })
  .strict();

export const updateDealSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    valueRupees: rupees,
    stageId: z.string().max(40),
    ownerUserId: z.string().max(40).nullable(),
    expectedCloseAt: dateOrEmpty,
    lostReason: z.string().trim().max(200),
    note: z.string().trim().min(1).max(1000),
  })
  .partial()
  .strict();

export const boardQuerySchema = z.object({ ownerUserId: z.string().max(40).optional(), q: z.string().trim().max(80).optional() });

const toDate = (v: string | undefined) => (v === undefined ? undefined : v ? new Date(v.length === 10 ? `${v}T00:00:00+05:30` : v) : null);
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;

async function assertMember(organizationId: string, userId: string | null | undefined) {
  if (!userId) return;
  if (!(await db.organizationMember.count({ where: { organizationId, userId } }))) throw new ApiError("VALIDATION_ERROR", "The owner must be a member of this workspace.", { details: { ownerUserId: ["Not a team member"] } });
}

async function stageOf(organizationId: string, stageId: string) {
  const s = await db.pipelineStage.findFirst({ where: { id: stageId, organizationId } });
  if (!s) throw new ApiError("VALIDATION_ERROR", "Pick a stage from this pipeline.", { details: { stageId: ["Unknown stage"] } });
  return s;
}

/** Keeps the contact in step with the deal: won → customer + won, lost → lost (only if no other deal is open). */
async function syncContact(ctx: Ctx, contactId: string, kind: string) {
  if (kind === "won") await updateContact(ctx, contactId, { lifecycle: "customer", leadStatus: "won" });
  else if (kind === "lost" && !(await db.deal.count({ where: { organizationId: ctx.organizationId, contactId, status: { in: ["open", "won"] } } }))) await updateContact(ctx, contactId, { leadStatus: "lost" });
}

const dealInclude = {
  contact: { select: { id: true, name: true, phone: true, email: true } },
  owner: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true, color: true, kind: true, probability: true } },
} as const;

type DealRow = Awaited<ReturnType<typeof loadDeal>>;
async function loadDeal(organizationId: string, id: string) {
  return db.deal.findFirst({ where: { id, organizationId }, include: { ...dealInclude, activities: { orderBy: { createdAt: "desc" }, take: 50 } } });
}

function dto(d: NonNullable<DealRow> | (Omit<NonNullable<DealRow>, "activities"> & { activities?: NonNullable<DealRow>["activities"] }), now = Date.now()) {
  return {
    id: d.id,
    title: d.title,
    valueRupees: d.valuePaise / 100,
    status: d.status,
    lostReason: d.lostReason,
    expectedCloseAt: d.expectedCloseAt,
    stageChangedAt: d.stageChangedAt,
    daysInStage: Math.floor((now - d.stageChangedAt.getTime()) / 86_400_000),
    overdue: Boolean(d.status === "open" && d.expectedCloseAt && d.expectedCloseAt.getTime() < now),
    closedAt: d.closedAt,
    createdAt: d.createdAt,
    contact: d.contact,
    owner: d.owner,
    stage: d.stage,
    activities: d.activities ?? [],
  };
}
export type DealDto = ReturnType<typeof dto>;

export async function getDeal(organizationId: string, id: string) {
  const d = await loadDeal(organizationId, id);
  if (!d) throw new ApiError("NOT_FOUND", "Deal not found.");
  const score = (await scoreContacts(organizationId, [d.contactId])).get(d.contactId) ?? null;
  return { ...dto(d), score };
}

export async function createDeal(ctx: Ctx, input: z.infer<typeof createDealSchema>) {
  const contact = await db.contact.findFirst({ where: { id: input.contactId, organizationId: ctx.organizationId }, select: { id: true, ownerUserId: true } });
  if (!contact) throw new ApiError("VALIDATION_ERROR", "Pick a contact from this workspace.", { details: { contactId: ["Unknown contact"] } });
  const stages = await getStages(ctx.organizationId);
  const stage = input.stageId ? await stageOf(ctx.organizationId, input.stageId) : stages.find((s) => s.kind === "open")!;
  const ownerUserId = input.ownerUserId === undefined ? (contact.ownerUserId ?? ctx.actorUserId) : input.ownerUserId;
  await assertMember(ctx.organizationId, ownerUserId);
  const d = await db.deal.create({
    data: {
      organizationId: ctx.organizationId,
      contactId: contact.id,
      stageId: stage.id,
      title: input.title,
      valuePaise: Math.round(input.valueRupees * 100),
      ownerUserId,
      expectedCloseAt: toDate(input.expectedCloseAt) ?? null,
      status: stage.kind,
      closedAt: stage.kind === "open" ? null : new Date(),
      activities: { create: { kind: "created", actorId: ctx.actorUserId, text: `Deal created in “${stage.name}”${input.valueRupees ? ` · ${inr(Math.round(input.valueRupees * 100))}` : ""}` } },
    },
  });
  if (stage.kind !== "open") await syncContact(ctx, contact.id, stage.kind);
  await audit({ action: "deal.created", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "deal", targetId: d.id, metadata: { stage: stage.name }, req: ctx.req });
  return getDeal(ctx.organizationId, d.id);
}

export async function updateDeal(ctx: Ctx, id: string, patch: z.infer<typeof updateDealSchema>) {
  const d = await db.deal.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { stage: true } });
  if (!d) throw new ApiError("NOT_FOUND", "Deal not found.");
  const data: Record<string, unknown> = {};
  const acts: { kind: string; text: string }[] = [];
  if (patch.title !== undefined && patch.title !== d.title) data.title = patch.title;
  if (patch.valueRupees !== undefined) {
    const v = Math.round(patch.valueRupees * 100);
    if (v !== d.valuePaise) {
      data.valuePaise = v;
      acts.push({ kind: "value", text: `Value ${inr(d.valuePaise)} → ${inr(v)}` });
    }
  }
  if (patch.ownerUserId !== undefined && patch.ownerUserId !== d.ownerUserId) {
    await assertMember(ctx.organizationId, patch.ownerUserId);
    data.ownerUserId = patch.ownerUserId;
    const u = patch.ownerUserId ? await db.user.findUnique({ where: { id: patch.ownerUserId }, select: { name: true } }) : null;
    acts.push({ kind: "owner", text: u ? `Owner: ${u.name}` : "Owner removed" });
  }
  if (patch.expectedCloseAt !== undefined) data.expectedCloseAt = toDate(patch.expectedCloseAt);
  if (patch.lostReason !== undefined) data.lostReason = patch.lostReason;
  let movedTo: Awaited<ReturnType<typeof stageOf>> | null = null;
  if (patch.stageId && patch.stageId !== d.stageId) {
    movedTo = await stageOf(ctx.organizationId, patch.stageId);
    Object.assign(data, { stageId: movedTo.id, status: movedTo.kind, stageChangedAt: new Date(), closedAt: movedTo.kind === "open" ? null : new Date(), ...(movedTo.kind !== "lost" ? { lostReason: "" } : {}) });
    const reason = movedTo.kind === "lost" && patch.lostReason ? ` (${patch.lostReason})` : "";
    acts.push({ kind: movedTo.kind === "open" ? "stage" : movedTo.kind, text: `${d.stage.name} → ${movedTo.name}${reason}` });
  }
  if (patch.note) acts.push({ kind: "note", text: patch.note });
  await db.deal.update({ where: { id }, data: { ...data, ...(acts.length ? { activities: { create: acts.map((a) => ({ ...a, actorId: ctx.actorUserId })) } } : {}) } });
  if (movedTo && movedTo.kind !== "open") await syncContact(ctx, d.contactId, movedTo.kind);
  await audit({ action: "deal.updated", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "deal", targetId: id, metadata: { fields: Object.keys(patch), stage: movedTo?.name }, req: ctx.req });
  return getDeal(ctx.organizationId, id);
}

export async function deleteDeal(ctx: Ctx, id: string) {
  const r = await db.deal.deleteMany({ where: { id, organizationId: ctx.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Deal not found.");
  await audit({ action: "deal.deleted", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "deal", targetId: id, req: ctx.req });
}

/** The Kanban board: every stage with its open deals, plus deals closed in the last 30 days. */
export async function board(organizationId: string, q: z.infer<typeof boardQuerySchema>, now = new Date()) {
  const stages = await getStages(organizationId);
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const term = q.q?.trim();
  const deals = await db.deal.findMany({
    where: {
      organizationId,
      ...(q.ownerUserId ? { ownerUserId: q.ownerUserId === "none" ? null : q.ownerUserId } : {}),
      OR: [{ status: "open" }, { closedAt: { gte: since } }],
      ...(term ? { AND: [{ OR: [{ title: { contains: term } }, { contact: { name: { contains: term } } }, { contact: { phone: { contains: term } } }] }] } : {}),
    },
    include: dealInclude,
    orderBy: [{ stageChangedAt: "desc" }],
    take: 1000,
  });
  const scores = await scoreContacts(organizationId, [...new Set(deals.map((d) => d.contactId))]);
  return {
    stages: stages.map((s) => {
      const list = deals.filter((d) => d.stageId === s.id).map((d) => ({ ...dto(d, now.getTime()), heat: scores.get(d.contactId)?.heat ?? "cold", score: scores.get(d.contactId)?.score ?? 0 }));
      return { id: s.id, name: s.name, color: s.color, kind: s.kind, probability: s.probability, count: list.length, valueRupees: list.reduce((a, d) => a + d.valueRupees, 0), deals: list };
    }),
  };
}

/** Pipeline numbers: open value, weighted forecast, this month's wins and losses, win rate, and each salesperson. */
export async function pipelineStats(organizationId: string, now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  const monthStart = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 5.5 * 3_600_000);
  const ninety = new Date(now.getTime() - 90 * 86_400_000);
  const [open, wonMonth, lostMonth, closed90, members] = await Promise.all([
    db.deal.findMany({ where: { organizationId, status: "open" }, select: { valuePaise: true, ownerUserId: true, stageChangedAt: true, expectedCloseAt: true, stage: { select: { probability: true } } } }),
    db.deal.findMany({ where: { organizationId, status: "won", closedAt: { gte: monthStart } }, select: { valuePaise: true, ownerUserId: true, createdAt: true, closedAt: true } }),
    db.deal.count({ where: { organizationId, status: "lost", closedAt: { gte: monthStart } } }),
    db.deal.groupBy({ by: ["status"], where: { organizationId, status: { in: ["won", "lost"] }, closedAt: { gte: ninety } }, _count: { _all: true } }),
    db.organizationMember.findMany({ where: { organizationId }, select: { userId: true, user: { select: { name: true } } } }),
  ]);
  const won90 = closed90.find((c) => c.status === "won")?._count._all ?? 0;
  const lost90 = closed90.find((c) => c.status === "lost")?._count._all ?? 0;
  const days = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 86_400_000;
  const people = members.map((m) => {
    const mine = open.filter((d) => d.ownerUserId === m.userId);
    const wins = wonMonth.filter((d) => d.ownerUserId === m.userId);
    return { userId: m.userId, name: m.user.name, openDeals: mine.length, openRupees: mine.reduce((a, d) => a + d.valuePaise, 0) / 100, wonDeals: wins.length, wonRupees: wins.reduce((a, d) => a + d.valuePaise, 0) / 100 };
  });
  return {
    openDeals: open.length,
    openRupees: open.reduce((a, d) => a + d.valuePaise, 0) / 100,
    forecastRupees: Math.round(open.reduce((a, d) => a + (d.valuePaise * d.stage.probability) / 100, 0)) / 100,
    wonThisMonth: wonMonth.length,
    wonRupeesThisMonth: wonMonth.reduce((a, d) => a + d.valuePaise, 0) / 100,
    lostThisMonth: lostMonth,
    winRate90: won90 + lost90 ? Math.round((won90 / (won90 + lost90)) * 100) : null,
    avgDaysToWin: wonMonth.length ? Math.round(wonMonth.reduce((a, d) => a + days(d.createdAt, d.closedAt ?? now), 0) / wonMonth.length) : null,
    stuck: open.filter((d) => days(d.stageChangedAt, now) > 14).length,
    overdue: open.filter((d) => d.expectedCloseAt && d.expectedCloseAt < now).length,
    people: people.filter((p) => p.openDeals || p.wonDeals).sort((a, b) => b.wonRupees - a.wonRupees || b.openRupees - a.openRupees),
  };
}

/** Deals for one contact (contact page). */
export async function contactDeals(organizationId: string, contactId: string) {
  const rows = await db.deal.findMany({ where: { organizationId, contactId }, include: dealInclude, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((d) => dto(d));
}
