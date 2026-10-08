import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { OPERATIONAL_ORDER_TYPES, ORDER_TRANSITIONS, type OrderStatus } from "@/lib/clinical/states";
import { AppError } from "@/lib/errors";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { orderCreateSchema, orderUpdateSchema } from "@/lib/validation/clinical";
import type { Client } from "./clinic-shared";
import { clinicalGuard } from "./consultation";

/**
 * Doctor orders = operational tasks created from a consultation ("dispense", "CBC", "dressing"). They are NOT the prescription:
 * nothing in this file reads or writes prescriptions, so an operational user can never alter a doctor's prescription through an order.
 */
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const view = (o: Record<string, unknown> & { createdAt: Date; updatedAt: Date; completedAt: Date | null }) => ({ ...o, tenantId: undefined, createdAt: o.createdAt.toISOString(), updatedAt: o.updatedAt.toISOString(), completedAt: o.completedAt?.toISOString() ?? null });

export async function createOrder(ctx: TenantRequestContext, consultationId: string, raw: unknown) {
  clinicalGuard(ctx);
  if (ctx.user.role !== "DOCTOR" || !ctx.permissions.has("orders.create")) throw new AppError("FORBIDDEN", { message: "Only doctors create orders." });
  const input = parseOrThrow(orderCreateSchema, raw);
  const c = await db(ctx).consultation.findFirst({ where: { id: consultationId }, select: { id: true, patientId: true, doctorUserId: true, status: true } });
  if (!c) throw new AppError("NOT_FOUND", { message: "Consultation not found." });
  if (c.doctorUserId !== ctx.user.id) throw new AppError("FORBIDDEN", { message: "Only the treating doctor can create orders for this consultation." });
  if (c.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This consultation was cancelled." });
  if (input.assignedToId) {
    const u = await db(ctx).user.findFirst({ where: { id: input.assignedToId, status: "ACTIVE", deletedAt: null, role: { key: { in: ["NURSE", "COMPOUNDER", "RECEPTIONIST", "LAB_STAFF", "STAFF", "DOCTOR"] } } }, select: { id: true } });
    if (!u) throw new AppError("VALIDATION_ERROR", { message: "Choose a staff member from this clinic.", fieldErrors: { assignedToId: "Choose a staff member from this clinic." } });
  }
  const o = await db(ctx).doctorOrder.create({ data: { tenantId: ctx.tenantId, patientId: c.patientId, consultationId, doctorUserId: ctx.user.id, assignedToId: input.assignedToId ?? null, type: input.type, title: input.title, description: input.description ?? null, priority: input.priority, createdById: ctx.user.id } });
  await recordAudit({ action: AUDIT_ACTIONS.ORDER_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "doctor_order", entityId: o.id, metadata: { consultationId, type: input.type, priority: input.priority } });
  return { id: o.id as string };
}

/** Task list: doctors see their own orders, admins all, nurses/compounders only the types they work on that are assigned to them or unassigned. */
export async function listOrders(ctx: TenantRequestContext, q: { status?: string; consultationId?: string }) {
  clinicalGuard(ctx);
  if (!ctx.permissions.has("orders.view")) throw new AppError("FORBIDDEN");
  if (q.consultationId && !(await db(ctx).consultation.findFirst({ where: { id: q.consultationId }, select: { id: true } }))) throw new AppError("NOT_FOUND", { message: "Consultation not found." });
  const role = ctx.user.role;
  const scope = role === "DOCTOR" ? { doctorUserId: ctx.user.id } : role === "CLINIC_ADMIN" ? {} : { type: { in: [...(OPERATIONAL_ORDER_TYPES[role] ?? [])] }, OR: [{ assignedToId: ctx.user.id }, { assignedToId: null }] };
  const status = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(q.status ?? "") ? q.status : undefined;
  const rows = await db(ctx).doctorOrder.findMany({ where: { ...scope, ...(q.consultationId ? { consultationId: q.consultationId } : {}), ...(status ? { status } : q.consultationId ? {} : { status: { in: ["PENDING", "IN_PROGRESS"] } }) }, orderBy: { createdAt: "asc" }, take: 100 });
  const rank: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2 };
  rows.sort((a: { priority: string }, b: { priority: string }) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3));
  const ids = [...new Set(rows.map((r: { patientId: string }) => r.patientId))] as string[];
  const showId = ctx.permissions.has("patients.identity") || ctx.permissions.has("patients.view");
  const patients = showId && ids.length ? await db(ctx).patient.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } }) : [];
  const pm = new Map(patients.map((p: { id: string; code: string; name: string }) => [p.id, p]));
  return { orders: rows.map((r: Parameters<typeof view>[0] & { patientId: string }) => ({ ...view(r), patient: pm.get(r.patientId) ?? null })) };
}

export async function updateOrderStatus(ctx: TenantRequestContext, orderId: string, raw: unknown) {
  clinicalGuard(ctx);
  const { status: to } = parseOrThrow(orderUpdateSchema, raw);
  const o = await db(ctx).doctorOrder.findFirst({ where: { id: orderId } });
  if (!o) throw new AppError("NOT_FOUND", { message: "Order not found." });
  if (await db(ctx).investigationOrder.findFirst({ where: { doctorOrderId: orderId }, select: { id: true } })) throw new AppError("CONFLICT", { message: "This order is managed by the laboratory. Its status follows the lab order." });
  const doctorOwner = ctx.user.role === "DOCTOR" && o.doctorUserId === ctx.user.id && ctx.permissions.has("orders.create");
  if (!doctorOwner) {
    const allowedTypes = OPERATIONAL_ORDER_TYPES[ctx.user.role] ?? [];
    if (!ctx.permissions.has("orders.update") || !allowedTypes.includes(o.type) || (o.assignedToId && o.assignedToId !== ctx.user.id)) throw new AppError("FORBIDDEN", { message: "You can't change this order." });
    if (to === "CANCELLED") throw new AppError("FORBIDDEN", { message: "Only the doctor can cancel an order." });
  }
  const from = o.status as OrderStatus;
  if (!ORDER_TRANSITIONS[from].includes(to)) throw new AppError("CONFLICT", { message: `A ${from.toLowerCase().replace("_", " ")} order can't be set to ${to.toLowerCase().replace("_", " ")}.` });
  const done = to === "COMPLETED";
  const r = await db(ctx).doctorOrder.updateMany({ where: { id: orderId, status: from }, data: { status: to, ...(done ? { completedAt: new Date(), completedById: ctx.user.id } : {}), ...(!o.assignedToId && !doctorOwner ? { assignedToId: ctx.user.id } : {}) } });
  if (r.count !== 1) throw new AppError("CONFLICT", { message: "This order was just changed by someone else. Refresh and try again." });
  await recordAudit({ action: done ? AUDIT_ACTIONS.ORDER_COMPLETED : AUDIT_ACTIONS.ORDER_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "doctor_order", entityId: orderId, metadata: { from, to } });
  return { status: to };
}
