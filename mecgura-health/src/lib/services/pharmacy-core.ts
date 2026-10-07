import "server-only";
import { AUDIT_ACTIONS, recordAudit, type AuditAction } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions/constants";
import { batchDisplayStatus, type LedgerType } from "@/lib/pharmacy/stock";
import { todayIn } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { nextCounter, tenantTimezone, type Client } from "./clinic-shared";

/**
 * Shared pharmacy plumbing: guards, settings, the clinic's configurable lists and — most importantly — `applyStock`, the ONLY way stock
 * quantities change. It updates the batch with a compare-and-swap (never below zero) and writes the immutable ledger row in the
 * caller's database transaction, so a stock change without a ledger entry (or a ledger entry without a stock change) cannot happen.
 */
export const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
export const PAGE = 20;
export const pad = (n: number) => String(n).padStart(6, "0");
export const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export function guard(ctx: TenantRequestContext, ...any: Permission[]) {
  if (ctx.user.role === "SUPER_ADMIN") throw new AppError("FORBIDDEN", { message: "Platform administrators don't open clinic pharmacy records." });
  if (!any.some((p) => ctx.permissions.has(p))) throw new AppError("FORBIDDEN");
}
export const todayFor = async (tenantId: string) => todayIn(await tenantTimezone(tenantId));

export interface PharmacySettingsView { nearExpiryDays: number; allowOverDispense: boolean; allowPatientReturns: boolean; returnWindowDays: number; billFooter: string | null }
export async function loadPharmacySettings(client: Client, tenantId: string): Promise<PharmacySettingsView> {
  const s = await client.pharmacySettings.findFirst({ where: { tenantId } });
  return { nearExpiryDays: s?.nearExpiryDays ?? 90, allowOverDispense: s?.allowOverDispense ?? false, allowPatientReturns: s?.allowPatientReturns ?? false, returnWindowDays: s?.returnWindowDays ?? 7, billFooter: s?.billFooter ?? null };
}

export async function userNames(tdb: Client, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  const rows = list.length ? await tdb.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } }) : [];
  return new Map<string, string>(rows.map((u: { id: string; name: string }) => [u.id, u.name]));
}

/** What a medicine's stock means for dispensing: only valid (not expired), unblocked, non-empty batches count as available. */
export async function sellableStock(tdb: Client, today: string, medicineIds?: string[]) {
  const rows = (await tdb.medicineBatch.groupBy({ by: ["medicineId"], where: { status: "ACTIVE", expiryDate: { gte: today }, quantityAvailable: { gt: 0 }, ...(medicineIds ? { medicineId: { in: medicineIds } } : {}) }, _sum: { quantityAvailable: true } })) as { medicineId: string; _sum: { quantityAvailable: number | null } }[];
  return new Map<string, number>(rows.map((r) => [r.medicineId, r._sum.quantityAvailable ?? 0]));
}
export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
export const lowThreshold = (m: { reorderLevel: number; minimumStock: number }) => Math.max(m.reorderLevel, m.minimumStock);
export function stockStatus(available: number, m: { reorderLevel: number; minimumStock: number }): StockStatus {
  if (available <= 0) return "OUT_OF_STOCK";
  const t = lowThreshold(m);
  return t > 0 && available <= t ? "LOW_STOCK" : "IN_STOCK";
}

export interface StockChange {
  batchId: string; type: LedgerType; delta: number; referenceType?: string; referenceId?: string; reason?: string; notes?: string;
  /** informational batch counters to bump together with the change (e.g. { dispensedQuantity: 3 }) */
  bump?: Partial<Record<"quantityReceived" | "dispensedQuantity" | "returnedQuantity" | "damagedQuantity" | "expiredQuantity", number>>;
}
/** Atomic stock change + ledger row. Call ONLY inside a `tdb.$transaction`. Refuses to take a batch below zero. */
export async function applyStock(tx: Client, ctx: TenantRequestContext, c: StockChange) {
  if (!Number.isInteger(c.delta) || c.delta === 0) throw new AppError("VALIDATION_ERROR", { message: "Quantity must be a whole number above zero." });
  const data: Record<string, unknown> = { quantityAvailable: { increment: c.delta } };
  for (const [k, v] of Object.entries(c.bump ?? {})) if (v) data[k] = { increment: v };
  const r = await tx.medicineBatch.updateMany({ where: { id: c.batchId, tenantId: ctx.tenantId, ...(c.delta < 0 ? { quantityAvailable: { gte: -c.delta } } : {}) }, data });
  if (r.count !== 1) {
    const exists = await tx.medicineBatch.findFirst({ where: { id: c.batchId, tenantId: ctx.tenantId }, select: { quantityAvailable: true } });
    if (!exists) throw new AppError("NOT_FOUND", { message: "That batch doesn't exist." });
    throw new AppError("CONFLICT", { message: `Not enough stock in this batch (${exists.quantityAvailable} available). Someone else may have just used it.` });
  }
  const b = await tx.medicineBatch.findFirst({ where: { id: c.batchId, tenantId: ctx.tenantId }, select: { medicineId: true, quantityAvailable: true } });
  const row = await tx.stockTransaction.create({ data: { tenantId: ctx.tenantId, medicineId: b.medicineId, batchId: c.batchId, type: c.type, quantity: c.delta, balanceAfter: b.quantityAvailable, referenceType: c.referenceType ?? null, referenceId: c.referenceId ?? null, reason: c.reason ?? null, notes: c.notes ?? null, createdById: ctx.user.id }, select: { id: true } });
  return { transactionId: row.id as string, balanceAfter: b.quantityAvailable as number, medicineId: b.medicineId as string };
}

export const nextNumber = async (tx: Client, tenantId: string, key: string) => pad(await nextCounter(tx, tenantId, key));

export interface BatchView {
  id: string; medicineId: string; batchNumber: string; expiryDate: string; manufacturingDate: string | null; purchasePriceMinor: number; sellingPriceMinor: number;
  quantityReceived: number; quantityAvailable: number; reservedQuantity: number; dispensedQuantity: number; returnedQuantity: number; damagedQuantity: number; expiredQuantity: number;
  status: string; displayStatus: string; blockedReason: string | null; daysRemaining: number;
}
export function batchView(b: Record<string, any>, today: string, lowAt: number): BatchView {
  return {
    id: b.id, medicineId: b.medicineId, batchNumber: b.batchNumber, expiryDate: b.expiryDate, manufacturingDate: b.manufacturingDate ?? null, purchasePriceMinor: b.purchasePriceMinor, sellingPriceMinor: b.sellingPriceMinor,
    quantityReceived: b.quantityReceived, quantityAvailable: b.quantityAvailable, reservedQuantity: b.reservedQuantity, dispensedQuantity: b.dispensedQuantity, returnedQuantity: b.returnedQuantity, damagedQuantity: b.damagedQuantity, expiredQuantity: b.expiredQuantity,
    status: b.status, displayStatus: batchDisplayStatus(b as never, today, lowAt), blockedReason: b.blockedReason ?? null, daysRemaining: Math.round((Date.parse(`${b.expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000),
  };
}

export async function audit(ctx: TenantRequestContext, action: AuditAction, entityType: string, entityId: string, metadata: Record<string, unknown> = {}) {
  await recordAudit({ action, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType, entityId, metadata });
}
export { AUDIT_ACTIONS };
