import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { FEATURES } from "@/lib/platform/features";
import { LIMITS, annualSavingMinor, limitText, normalizeFeatures, normalizeLimits, parseJson, planInputSchema, validatePlanKeys, type PlanFeatures, type PlanLimits } from "@/lib/subscriptions/catalog";
import { guard } from "./platform-core";
import { changedKeys, containsCI, uniqueViolation } from "./shared";

type PlanRow = NonNullable<Awaited<ReturnType<typeof db.plan.findFirst>>>;
/** A plan made in Phase 15 states its features explicitly. Older rows (empty feature map) are legacy menu bundles and cannot be sold. */
export const isCommercial = (p: { features: string }) => Object.keys(parseJson<Record<string, boolean>>(p.features, {})).length > 0;

export function shapePlan(p: PlanRow) {
  const features = normalizeFeatures(parseJson(p.features, {})); const limits = normalizeLimits(parseJson(p.limits, {}));
  return {
    id: p.id, slug: p.key, name: p.name, description: p.description ?? "", status: p.status, currency: p.currency, monthlyPriceMinor: p.monthlyPriceMinor, annualPriceMinor: p.annualPriceMinor, setupFeeMinor: p.setupFeeMinor,
    trialDays: p.trialDays, isPublic: p.isPublic, sortOrder: p.sortOrder, supportLevel: p.supportLevel ?? "", version: p.version, features, limits, commercial: isCommercial(p), annualSavingMinor: annualSavingMinor(p), archivedAt: p.archivedAt, updatedAt: p.updatedAt,
    featureList: FEATURES.map((f) => ({ key: f.key, label: f.label, group: f.group, included: features[f.key] === true })),
    limitList: LIMITS.map((l) => ({ key: l.key, label: l.label, text: limitText(limits[l.key], l.unit), mode: limits[l.key].mode, value: limits[l.key].value ?? null })),
  };
}
export type PlanView = ReturnType<typeof shapePlan>;

/** Anyone (pricing page): only ACTIVE + public + commercial plans, in the order the Super Admin chose. Prices come straight from the records. */
export async function publicPlans(): Promise<PlanView[]> {
  const rows = await db.plan.findMany({ where: { status: "ACTIVE", isPublic: true }, orderBy: [{ sortOrder: "asc" }, { monthlyPriceMinor: "asc" }] });
  return rows.filter(isCommercial).map(shapePlan);
}
/** Plans a clinic may switch to: the public ones plus the plan it is already on. */
export async function selectablePlans(tenantId: string): Promise<PlanView[]> {
  const sub = await db.subscription.findUnique({ where: { tenantId }, select: { planId: true } });
  const rows = await db.plan.findMany({ where: { OR: [{ status: "ACTIVE", isPublic: true }, ...(sub ? [{ id: sub.planId }] : [])] }, orderBy: [{ sortOrder: "asc" }, { monthlyPriceMinor: "asc" }] });
  return rows.filter(isCommercial).map(shapePlan);
}

export async function listPlans(ctx: RequestContext, q: { status?: string; q?: string } = {}) {
  guard(ctx);
  const rows = await db.plan.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.q ? { OR: [{ name: containsCI(q.q) }, { key: containsCI(q.q) }] } : {}) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const counts = await db.subscription.groupBy({ by: ["planId"], where: { managed: true, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE", "GRACE", "PAUSED", "SUSPENDED", "PENDING_PAYMENT"] } }, _count: { _all: true } });
  const by = new Map(counts.map((c) => [c.planId, c._count._all]));
  return rows.map((r) => ({ ...shapePlan(r), subscribers: by.get(r.id) ?? 0 }));
}
export async function getPlanForAdmin(ctx: RequestContext, id: string) {
  guard(ctx); const p = await db.plan.findUnique({ where: { id } }); if (!p) throw new AppError("NOT_FOUND", { message: "That plan doesn't exist." });
  const subscribers = await db.subscription.count({ where: { planId: id, managed: true, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE", "GRACE", "PAUSED", "SUSPENDED", "PENDING_PAYMENT"] } } });
  return { ...shapePlan(p), subscribers };
}

function parsePlan(input: unknown) {
  const r = planInputSchema.safeParse(input);
  if (!r.success) { const fe: Record<string, string> = {}; for (const i of r.error.issues) fe[i.path.join(".") || "form"] ??= i.message; throw new AppError("VALIDATION_ERROR", { fieldErrors: fe }); }
  const bad = validatePlanKeys(r.data); if (bad) throw new AppError("VALIDATION_ERROR", { message: bad });
  for (const [k, l] of Object.entries(r.data.limits)) if (l.mode === "LIMITED" && LIMITS.find((x) => x.key === k) === undefined) throw new AppError("VALIDATION_ERROR", { message: `Unknown limit “${k}”.` });
  return r.data;
}
function assertSellable(d: { status: string; monthlyPriceMinor: number; annualPriceMinor: number }) {
  if (d.status === "ACTIVE" && d.monthlyPriceMinor > 0 && d.annualPriceMinor === 0) throw new AppError("VALIDATION_ERROR", { fieldErrors: { annualPriceMinor: "Set a yearly price (or make the plan free)." } });
  if (d.status === "ACTIVE" && d.monthlyPriceMinor === 0 && d.annualPriceMinor > 0) throw new AppError("VALIDATION_ERROR", { fieldErrors: { monthlyPriceMinor: "Set a monthly price (or make the plan free)." } });
}

/** Create (id = null) or edit. Editing a commercial field bumps `version`; subscriptions keep their own snapshot, so no existing customer is silently re-priced or re-limited. */
export async function savePlan(ctx: RequestContext, id: string | null, input: unknown) {
  guard(ctx); const d = parsePlan(input); if (!id) assertSellable(d);
  const data = {
    name: d.name, key: d.slug, description: d.description || null, status: d.status, currency: d.currency, monthlyPriceMinor: d.monthlyPriceMinor, annualPriceMinor: d.annualPriceMinor, setupFeeMinor: d.setupFeeMinor, trialDays: d.trialDays,
    isPublic: d.isPublic, sortOrder: d.sortOrder, supportLevel: d.supportLevel || null, features: JSON.stringify(normalizeFeatures(d.features)), limits: JSON.stringify(normalizeLimits(d.limits as PlanLimits)), isActive: d.status === "ACTIVE",
  };
  try {
    if (!id) {
      const created = await db.plan.create({ data: { ...data, modules: "[]", archivedAt: d.status === "ARCHIVED" ? new Date() : null } });
      await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_PLAN_SAVED, tenantId: null, actorId: ctx.user.id, entityType: "plan", entityId: created.id, metadata: { created: true, slug: d.slug, version: 1 } });
      return shapePlan(created);
    }
    const before = await db.plan.findUnique({ where: { id } }); if (!before) throw new AppError("NOT_FOUND", { message: "That plan doesn't exist." });
    if (before.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "An archived plan can't be edited. Restore it first." });
    const commercial = ["monthlyPriceMinor", "annualPriceMinor", "setupFeeMinor", "trialDays", "features", "limits", "currency"] as const;
    const changed = changedKeys(before as unknown as Record<string, unknown>, data).filter((k) => k !== "status" && k !== "isActive");
    const bump = commercial.some((k) => changed.includes(k));
    assertSellable({ status: before.status, monthlyPriceMinor: d.monthlyPriceMinor, annualPriceMinor: d.annualPriceMinor });
    // status changes only through setPlanStatus (so every move is validated and audited)
    const upd = await db.plan.update({ where: { id }, data: { ...data, status: before.status, isActive: before.status === "ACTIVE", isPublic: before.status === "ACTIVE" ? d.isPublic : false, ...(bump ? { version: { increment: 1 } } : {}) } });
    await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_PLAN_SAVED, tenantId: null, actorId: ctx.user.id, entityType: "plan", entityId: id, metadata: { changed, version: upd.version, before: { monthlyPriceMinor: before.monthlyPriceMinor, annualPriceMinor: before.annualPriceMinor, status: before.status }, after: { monthlyPriceMinor: upd.monthlyPriceMinor, annualPriceMinor: upd.annualPriceMinor, status: upd.status } } });
    return shapePlan(upd);
  } catch (e) { if (uniqueViolation(e)) throw new AppError("CONFLICT", { message: "Another plan already uses that slug.", fieldErrors: { slug: "Already in use." } }); throw e; }
}

const PLAN_MOVES: Record<string, string[]> = { DRAFT: ["ACTIVE", "ARCHIVED"], ACTIVE: ["INACTIVE", "ARCHIVED"], INACTIVE: ["ACTIVE", "ARCHIVED"], ARCHIVED: ["INACTIVE"] };
/** Plans are never deleted: archiving hides them from new sales while existing subscribers keep their snapshot. */
export async function setPlanStatus(ctx: RequestContext, id: string, status: string) {
  guard(ctx); const p = await db.plan.findUnique({ where: { id } }); if (!p) throw new AppError("NOT_FOUND", { message: "That plan doesn't exist." });
  if (!(PLAN_MOVES[p.status] ?? []).includes(status)) throw new AppError("CONFLICT", { message: `A ${p.status.toLowerCase()} plan can't become ${status.toLowerCase()}.` });
  if (status === "ACTIVE") { if (!isCommercial(p)) throw new AppError("VALIDATION_ERROR", { message: "Set the plan's features and limits before activating it." }); assertSellable({ status, monthlyPriceMinor: p.monthlyPriceMinor, annualPriceMinor: p.annualPriceMinor }); }
  const upd = await db.plan.update({ where: { id }, data: { status, isActive: status === "ACTIVE", archivedAt: status === "ARCHIVED" ? new Date() : null, ...(status === "ARCHIVED" || status === "INACTIVE" ? { isPublic: false } : {}) } });
  await recordAudit({ action: AUDIT_ACTIONS.SUBSCRIPTION_PLAN_STATUS_CHANGED, tenantId: null, actorId: ctx.user.id, entityType: "plan", entityId: id, metadata: { from: p.status, to: status } });
  return shapePlan(upd);
}
export type { PlanFeatures };
