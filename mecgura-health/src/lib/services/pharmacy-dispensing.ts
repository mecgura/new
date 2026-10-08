import "server-only";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { allocateFefo, fefoOrder, isDispensable, itemKeys, medicineMatchesItem, prescribedUnits } from "@/lib/pharmacy/stock";
import { parseOrThrow } from "@/lib/validation";
import { dispenseCancelSchema, dispenseSchema, returnActionSchema, returnRequestSchema } from "@/lib/validation/pharmacy";
import { isUniqueViolation, nextCounter, type Client } from "./clinic-shared";
import { addInvoiceEvent, createPharmacyInvoice } from "./billing-invoices";
import { AUDIT_ACTIONS, PAGE, applyStock, audit, db, guard, iso, loadPharmacySettings, pad, todayFor, userNames } from "./pharmacy-core";
import { containsCI } from "./shared";

const medName = (m: { genericName: string; brandName: string | null; strength: string | null }) => [m.brandName ?? m.genericName, m.strength].filter(Boolean).join(" ");

/* --------------------------------------------- prescription worklist --------------------------------------------- */
type RxItem = { id: string; position: number; name: string; genericName: string | null; brandName: string | null; strength: string | null; dose: string | null; route: string | null; frequency: string | null; foodTiming: string | null; durationDays: number | null; quantity: number | null; quantityUnit: string | null; instructions: string | null };
// The itemKey is stable inside a prescription only; the worklist therefore groups per prescription.
async function dispensedFor(tdb: Client, prescriptionId: string) {
  const rows = (await tdb.dispensingItem.findMany({ where: { status: "DISPENSED", dispensing: { is: { prescriptionId, status: { not: "CANCELLED" } } } }, select: { itemKey: true, dispensedQuantity: true } })) as { itemKey: string; dispensedQuantity: number }[];
  const m = new Map<string, number>(); for (const r of rows) m.set(r.itemKey, (m.get(r.itemKey) ?? 0) + r.dispensedQuantity); return m;
}
function rxStatus(items: RxItem[], done: Map<string, number>): "PENDING" | "PARTIALLY_DISPENSED" | "DISPENSED" {
  const keys = itemKeys(items); let any = false; let all = true;
  items.forEach((i, n) => { const d = done.get(keys[n]) ?? 0; const p = prescribedUnits(i.quantity); if (d > 0) any = true; if (p > 0 ? d < p : d === 0) all = false; });
  return all && items.length ? "DISPENSED" : any ? "PARTIALLY_DISPENSED" : "PENDING";
}
export async function prescriptionQueue(ctx: TenantRequestContext, q: { status?: string; q?: string; page?: number } = {}) {
  guard(ctx, "pharmacy.dispense"); const tdb = db(ctx); const page = Math.max(1, Math.floor(q.page ?? 1)); const text = (q.q ?? "").trim().slice(0, 60);
  const where: Record<string, unknown> = { status: "FINALIZED" };
  if (text) {
    const pts = (await tdb.patient.findMany({ where: { OR: [{ name: containsCI(text) }, { code: containsCI(text) }] }, select: { id: true }, take: 100 })) as { id: string }[];
    where.OR = [{ number: containsCI(text) }, { patientId: { in: pts.map((p) => p.id) } }];
  }
  const rxs = (await tdb.prescription.findMany({ where, orderBy: { finalizedAt: "desc" }, take: 300, include: { items: { orderBy: { position: "asc" } } } })) as Record<string, any>[];
  const done = rxs.length ? await dispensedByKeyPerRx(tdb, rxs.map((r) => r.id as string)) : new Map<string, Map<string, number>>();
  const pts = (await tdb.patient.findMany({ where: { id: { in: [...new Set(rxs.map((r) => r.patientId as string))] } }, select: { id: true, code: true, name: true } })) as { id: string; code: string; name: string }[];
  const docs = await userNames(tdb, rxs.map((r) => r.doctorUserId));
  const all = rxs.filter((r) => r.items.length).map((r) => { const p = pts.find((x) => x.id === r.patientId); return { id: r.id as string, number: r.number as string | null, patientId: r.patientId as string, patientName: p?.name ?? "—", patientCode: p?.code ?? "", doctorName: docs.get(r.doctorUserId) ?? null, finalizedAt: iso(r.finalizedAt), itemCount: r.items.length as number, status: rxStatus(r.items, done.get(r.id) ?? new Map()) }; });
  const rows = (q.status && q.status !== "all" ? all.filter((r) => r.status === q.status) : all);
  return { rows: rows.slice((page - 1) * PAGE, page * PAGE), total: rows.length, page, pageSize: PAGE, capped: rxs.length === 300 };
}
async function dispensedByKeyPerRx(tdb: Client, ids: string[]) {
  const rows = (await tdb.dispensingItem.findMany({ where: { status: "DISPENSED", dispensing: { is: { prescriptionId: { in: ids }, status: { not: "CANCELLED" } } } }, select: { itemKey: true, dispensedQuantity: true, dispensing: { select: { prescriptionId: true } } } })) as { itemKey: string; dispensedQuantity: number; dispensing: { prescriptionId: string } }[];
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) { const m = out.get(r.dispensing.prescriptionId) ?? new Map<string, number>(); m.set(r.itemKey, (m.get(r.itemKey) ?? 0) + r.dispensedQuantity); out.set(r.dispensing.prescriptionId, m); }
  return out;
}

/** Everything the dispensing screen needs: the (read-only) prescription lines, what was already dispensed, and EXACT-match inventory candidates. */
export async function getPrescriptionForDispensing(ctx: TenantRequestContext, prescriptionId: string) {
  guard(ctx, "pharmacy.dispense"); const tdb = db(ctx); const today = await todayFor(ctx.tenantId);
  const rx = await tdb.prescription.findFirst({ where: { id: prescriptionId }, include: { items: { orderBy: { position: "asc" } } } });
  if (!rx) throw new AppError("NOT_FOUND", { message: "Prescription not found." });
  const patient = await tdb.patient.findFirst({ where: { id: rx.patientId }, select: { id: true, code: true, name: true, status: true } });
  const names = await userNames(tdb, [rx.doctorUserId]);
  const done = await dispensedFor(tdb, prescriptionId); const keys = itemKeys(rx.items as RxItem[]);
  const settings = await loadPharmacySettings(tdb, ctx.tenantId);
  const lines = [];
  for (let n = 0; n < rx.items.length; n++) {
    const it = rx.items[n] as RxItem; const words = [it.genericName, it.brandName, it.name].filter(Boolean) as string[];
    const cands = (await tdb.medicine.findMany({ where: { active: true, OR: words.flatMap((w) => [{ genericName: containsCI(w.slice(0, 40)) }, { brandName: containsCI(w.slice(0, 40)) }]) }, take: 30 })) as Record<string, any>[];
    const matching = cands.filter((m) => medicineMatchesItem(m as never, it));
    const medicines = [];
    for (const m of matching) {
      const batches = (await tdb.medicineBatch.findMany({ where: { medicineId: m.id, quantityAvailable: { gt: 0 } }, select: { id: true, batchNumber: true, expiryDate: true, status: true, quantityAvailable: true, sellingPriceMinor: true } })) as { id: string; batchNumber: string; expiryDate: string; status: string; quantityAvailable: number; sellingPriceMinor: number }[];
      const ordered = fefoOrder(batches, today);
      medicines.push({ id: m.id as string, name: medName(m as never), medicineCode: m.medicineCode as string, unit: m.unit as string, available: ordered.reduce((a, b) => a + b.quantityAvailable, 0), sellingPriceMinor: m.sellingPriceMinor as number, taxRateBp: m.taxRateBp as number, batches: ordered.map((b) => ({ id: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, quantityAvailable: b.quantityAvailable, sellingPriceMinor: b.sellingPriceMinor || (m.sellingPriceMinor as number) })), expiredOrBlockedUnits: batches.filter((b) => !isDispensable(b, today)).reduce((a, b) => a + b.quantityAvailable, 0) });
    }
    const prescribed = prescribedUnits(it.quantity); const d = done.get(keys[n]) ?? 0;
    lines.push({ prescriptionItemId: it.id, name: it.name, genericName: it.genericName, brandName: it.brandName, strength: it.strength, dose: it.dose, route: it.route, frequency: it.frequency, foodTiming: it.foodTiming, durationDays: it.durationDays, quantity: it.quantity, quantityUnit: it.quantityUnit, instructions: it.instructions, prescribedUnits: prescribed, dispensedUnits: d, remainingUnits: prescribed > 0 ? Math.max(0, prescribed - d) : null, medicines });
  }
  return { id: rx.id as string, number: rx.number as string | null, status: rx.status as string, version: rx.currentVersion as number, finalizedAt: iso(rx.finalizedAt), doctorName: names.get(rx.doctorUserId) ?? null, patient: patient ? { id: patient.id as string, code: patient.code as string, name: patient.name as string, archived: patient.status === "ARCHIVED" } : null, overallStatus: rxStatus(rx.items as RxItem[], done), allowOverDispense: settings.allowOverDispense, lines };
}

/* -------------------------------------------------------- dispense -------------------------------------------------------- */
export async function dispense(ctx: TenantRequestContext, prescriptionId: string, raw: unknown) {
  guard(ctx, "pharmacy.dispense");
  const v = parseOrThrow(dispenseSchema, raw); const tdb = db(ctx);
  const settings = await loadPharmacySettings(tdb, ctx.tenantId); const today = await todayFor(ctx.tenantId); const yr = today.slice(0, 4);
  const dup = await tdb.dispensing.findFirst({ where: { idempotencyKey: v.idempotencyKey }, select: { id: true, prescriptionId: true, dispensingNumber: true, invoiceId: true } });
  if (dup) { if (dup.prescriptionId !== prescriptionId) throw new AppError("CONFLICT", { message: "That request was already used." }); return { id: dup.id as string, dispensingNumber: dup.dispensingNumber as string, invoiceId: dup.invoiceId as string | null, duplicate: true as const }; }
  const rx = await tdb.prescription.findFirst({ where: { id: prescriptionId }, include: { items: { orderBy: { position: "asc" } } } });
  if (!rx) throw new AppError("NOT_FOUND", { message: "Prescription not found." });
  if (rx.status !== "FINALIZED") throw new AppError("CONFLICT", { message: "This prescription isn't finalized (the doctor may be amending it). It can't be dispensed right now." });
  const patient = await tdb.patient.findFirst({ where: { id: rx.patientId }, select: { id: true, status: true } });
  if (!patient) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  if (patient.status === "ARCHIVED") throw new AppError("CONFLICT", { message: "This patient record is archived." });
  const items = rx.items as RxItem[]; const keys = itemKeys(items);
  const ids = new Set<string>(); for (const r of v.items) { if (ids.has(r.prescriptionItemId)) throw new AppError("VALIDATION_ERROR", { message: "A medicine appears twice in the request." }); ids.add(r.prescriptionItemId); }

  let out: { id: string; dispensingNumber: string; invoiceId: string | null };
  try {
    out = await tdb.$transaction(async (tx: Client) => {
      await nextCounter(tx, ctx.tenantId, `rxdisp:${prescriptionId}`); // serialises dispensing of the same prescription (row lock)
      const doneRows = (await tx.dispensingItem.findMany({ where: { tenantId: ctx.tenantId, status: "DISPENSED", dispensing: { is: { prescriptionId, status: { not: "CANCELLED" } } } }, select: { itemKey: true, dispensedQuantity: true } })) as { itemKey: string; dispensedQuantity: number }[];
      const done = new Map<string, number>(); for (const r of doneRows) done.set(r.itemKey, (done.get(r.itemKey) ?? 0) + r.dispensedQuantity);
      const n = await nextCounter(tx, ctx.tenantId, `dsp:${yr}`);
      const d = await tx.dispensing.create({ data: { tenantId: ctx.tenantId, patientId: rx.patientId, prescriptionId, prescriptionVersion: rx.currentVersion, dispensingNumber: `DSP-${yr}-${pad(n)}`, dispensedById: ctx.user.id, status: "DISPENSED", notes: v.notes ?? null, idempotencyKey: v.idempotencyKey }, select: { id: true, dispensingNumber: true } });
      const billLines: { description: string; code: string; quantity: number; unitPriceMinor: number; taxRateBp: number; sourceId: string }[] = [];
      const created: { id: string; dispensedQuantity: number; batchId: string }[] = [];
      const progress = new Map(done);
      for (const r of v.items) {
        const idx = items.findIndex((i) => i.id === r.prescriptionItemId);
        if (idx < 0) throw new AppError("VALIDATION_ERROR", { message: "That medicine isn't on this prescription." });
        const it = items[idx]; const key = keys[idx]; const prescribed = prescribedUnits(it.quantity); const already = progress.get(key) ?? 0;
        const med = await tx.medicine.findFirst({ where: { id: r.medicineId, tenantId: ctx.tenantId, active: true } });
        if (!med) throw new AppError("NOT_FOUND", { message: "Medicine not found or not active." });
        if (!medicineMatchesItem(med, it)) throw new AppError("VALIDATION_ERROR", { message: `${medName(med)} doesn't match the prescribed ${it.name}. Prescribed medicine unavailable — contact the doctor; the prescription can't be changed from the pharmacy.` });
        if (prescribed > 0 && !settings.allowOverDispense && already + r.quantity > prescribed) throw new AppError("VALIDATION_ERROR", { message: `${it.name}: only ${Math.max(0, prescribed - already)} more can be dispensed (prescribed ${prescribed}, already dispensed ${already}).` });
        if (prescribed === 0 && !r.notes) throw new AppError("VALIDATION_ERROR", { message: `${it.name}: the doctor didn't state a quantity. Add a note with the quantity basis.` });
        const batches = (await tx.medicineBatch.findMany({ where: { tenantId: ctx.tenantId, medicineId: med.id } })) as { id: string; batchNumber: string; expiryDate: string; status: string; quantityAvailable: number; sellingPriceMinor: number }[];
        const suggestion = allocateFefo(batches, r.quantity, today);
        let allocs: { batchId: string; quantity: number; overrideReason?: string }[];
        if (r.allocations?.length) {
          const total = r.allocations.reduce((a, x) => a + x.quantity, 0);
          if (total !== r.quantity) throw new AppError("VALIDATION_ERROR", { message: `${it.name}: the batch quantities don't add up to ${r.quantity}.` });
          for (const a of r.allocations) { const b = batches.find((x) => x.id === a.batchId); if (!b) throw new AppError("VALIDATION_ERROR", { message: "That batch doesn't belong to this medicine." }); if (!isDispensable(b, today)) throw new AppError("CONFLICT", { message: `Batch ${b.batchNumber} can't be dispensed (${b.status === "BLOCKED" ? "blocked" : b.expiryDate < today ? "expired" : "no stock"}).` }); if (a.quantity > b.quantityAvailable) throw new AppError("CONFLICT", { message: `Batch ${b.batchNumber} has only ${b.quantityAvailable} available.` }); }
          const same = suggestion.short === 0 && r.allocations.length === suggestion.allocations.length && suggestion.allocations.every((s) => r.allocations!.some((a) => a.batchId === s.batchId && a.quantity === s.quantity));
          if (!same && !r.allocations.some((a) => a.overrideReason)) throw new AppError("VALIDATION_ERROR", { message: `${it.name}: give a reason for not using the first-expiry batch.` });
          allocs = r.allocations;
        } else {
          if (suggestion.short > 0) throw new AppError("CONFLICT", { message: `${it.name}: only ${r.quantity - suggestion.short} in stock (expired, blocked and empty batches are not counted). Dispense a smaller quantity.` });
          allocs = suggestion.allocations;
        }
        for (const a of allocs) {
          if (a.quantity > 999) throw new AppError("VALIDATION_ERROR", { message: "Dispense at most 999 units per batch at a time." });
          const b = batches.find((x) => x.id === a.batchId)!;
          const unit = b.sellingPriceMinor > 0 ? b.sellingPriceMinor : med.sellingPriceMinor;
          if (unit <= 0) throw new AppError("VALIDATION_ERROR", { message: `No selling price is set for ${medName(med)}. A manager must set it first.` });
          const di = await tx.dispensingItem.create({ data: { tenantId: ctx.tenantId, dispensingId: d.id, prescriptionItemId: it.id, itemKey: key, medicineId: med.id, batchId: b.id, medicineNameSnapshot: medName(med), batchNumberSnapshot: b.batchNumber, expirySnapshot: b.expiryDate, prescribedQuantity: prescribed, dispensedQuantity: a.quantity, unitPriceMinor: unit, taxRateBp: med.taxRateBp, totalMinor: 0, batchOverrideReason: a.overrideReason ?? null, notes: r.notes ?? null }, select: { id: true } });
          await applyStock(tx, ctx, { batchId: b.id, type: "DISPENSE", delta: -a.quantity, referenceType: "DISPENSING", referenceId: d.id, bump: { dispensedQuantity: a.quantity } });
          billLines.push({ description: `${medName(med)} — batch ${b.batchNumber}`, code: med.medicineCode, quantity: a.quantity, unitPriceMinor: unit, taxRateBp: med.taxRateBp, sourceId: di.id });
          created.push({ id: di.id, dispensedQuantity: a.quantity, batchId: b.id });
        }
        progress.set(key, already + r.quantity);
      }
      const inv = await createPharmacyInvoice(tx, ctx, { patientId: rx.patientId, consultationId: rx.consultationId, doctorUserId: rx.doctorUserId, sourceKey: `dispense:${d.id}`, lines: billLines });
      let total = 0;
      for (let i = 0; i < created.length; i++) {
        const l = inv.lines?.[i]; const t = l ? l.lineTotalMinor : 0; total += t;
        await tx.dispensingItem.update({ where: { id: created[i].id }, data: { taxMinor: l?.taxMinor ?? 0, totalMinor: t, taxName: billLines[i].taxRateBp ? "Tax" : null } });
      }
      const complete = items.every((it, i) => { const p = prescribedUnits(it.quantity); const dn = progress.get(keys[i]) ?? 0; return p > 0 ? dn >= p : dn > 0; });
      await tx.dispensing.update({ where: { id: d.id }, data: { invoiceId: inv.id, totalMinor: total, status: complete ? "DISPENSED" : "PARTIALLY_DISPENSED" } });
      return { id: d.id, dispensingNumber: d.dispensingNumber, invoiceId: inv.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) { const again = await tdb.dispensing.findFirst({ where: { idempotencyKey: v.idempotencyKey }, select: { id: true, dispensingNumber: true, invoiceId: true } }); if (again) return { ...again, duplicate: true as const }; throw new AppError("CONFLICT", { message: "Someone else just dispensed this prescription. Refresh and try again." }); }
    throw e;
  }
  await audit(ctx, AUDIT_ACTIONS.DISPENSING_CREATED, "dispensing", out.id, { number: out.dispensingNumber, prescriptionId, lines: v.items.length, invoiceId: out.invoiceId });
  return { ...out, duplicate: false as const };
}

/** Reverses a dispensing (REVERSAL ledger rows put the stock back). Only while nothing was collected on its bill and nothing was returned. */
export async function cancelDispensing(ctx: TenantRequestContext, id: string, raw: unknown) {
  guard(ctx, "pharmacy.return_approve");
  const v = parseOrThrow(dispenseCancelSchema, raw); const tdb = db(ctx);
  const d = await tdb.dispensing.findFirst({ where: { id }, include: { items: true } });
  if (!d) throw new AppError("NOT_FOUND", { message: "Dispensing not found." });
  if (d.status === "CANCELLED") throw new AppError("CONFLICT", { message: "This dispensing is already cancelled." });
  if (d.items.some((i: { returnedQuantity: number }) => i.returnedQuantity > 0)) throw new AppError("CONFLICT", { message: "A return exists for this dispensing, so it can't be cancelled." });
  await tdb.$transaction(async (tx: Client) => {
    const r = await tx.dispensing.updateMany({ where: { id, tenantId: ctx.tenantId, status: { not: "CANCELLED" } }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.user.id, cancelReason: v.reason } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "This dispensing was just cancelled." });
    if (d.invoiceId) {
      const inv = await tx.invoice.updateMany({ where: { id: d.invoiceId, tenantId: ctx.tenantId, status: "ISSUED", collectedMinor: 0 }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.user.id, cancelReason: `Pharmacy dispensing cancelled: ${v.reason}`, dueMinor: 0 } });
      if (inv.count !== 1) throw new AppError("CONFLICT", { message: "Payment was already collected on this bill. Refund it in Billing first, then cancel the dispensing." });
      await addInvoiceEvent(tx, ctx.tenantId, { id: d.invoiceId, patientId: d.patientId }, "CANCELLED", ctx.user.id, { note: "Pharmacy dispensing cancelled" });
    }
    for (const i of d.items as { id: string; batchId: string; dispensedQuantity: number }[]) {
      await applyStock(tx, ctx, { batchId: i.batchId, type: "REVERSAL", delta: i.dispensedQuantity, referenceType: "DISPENSING", referenceId: id, reason: v.reason, bump: { dispensedQuantity: -i.dispensedQuantity } });
      await tx.dispensingItem.update({ where: { id: i.id }, data: { status: "CANCELLED" } });
    }
  });
  await audit(ctx, AUDIT_ACTIONS.DISPENSING_CANCELLED, "dispensing", id, { number: d.dispensingNumber });
  return { status: "CANCELLED" };
}

export interface DispensingRow { id: string; dispensingNumber: string; patientId: string; patientName: string; patientCode: string; prescriptionNumber: string | null; status: string; totalMinor: number; items: number; dispensedAt: string; dispensedBy: string | null; invoiceId: string | null }
export async function listDispensings(ctx: TenantRequestContext, q: { q?: string; status?: string; from?: string; to?: string; patientId?: string; page?: number } = {}) {
  guard(ctx, "pharmacy.dispense", "pharmacy.reports"); const tdb = db(ctx); const page = Math.max(1, Math.floor(q.page ?? 1)); const text = (q.q ?? "").trim().slice(0, 60);
  const where: Record<string, unknown> = { ...(q.status ? { status: q.status } : {}), ...(q.patientId ? { patientId: q.patientId } : {}) };
  if (q.from || q.to) where.dispensedAt = { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lt: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) } : {}) };
  if (text) { const pts = (await tdb.patient.findMany({ where: { OR: [{ name: containsCI(text) }, { code: containsCI(text) }] }, select: { id: true }, take: 100 })) as { id: string }[]; where.OR = [{ dispensingNumber: containsCI(text) }, { patientId: { in: pts.map((p) => p.id) } }]; }
  const [total, rows] = await Promise.all([tdb.dispensing.count({ where }), tdb.dispensing.findMany({ where, orderBy: { dispensedAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { patient: { select: { code: true, name: true } }, prescription: { select: { number: true } }, _count: { select: { items: true } } } })]);
  const names = await userNames(tdb, rows.map((r: { dispensedById: string }) => r.dispensedById));
  return { rows: rows.map((r: Record<string, any>) => ({ id: r.id as string, dispensingNumber: r.dispensingNumber as string, patientId: r.patientId as string, patientName: r.patient.name as string, patientCode: r.patient.code as string, prescriptionNumber: r.prescription.number as string | null, status: r.status as string, totalMinor: r.totalMinor as number, items: r._count.items as number, dispensedAt: iso(r.dispensedAt) as string, dispensedBy: names.get(r.dispensedById) ?? null, invoiceId: r.invoiceId as string | null })) as DispensingRow[], total: total as number, page, pageSize: PAGE };
}
export async function getDispensing(ctx: TenantRequestContext, id: string) {
  guard(ctx, "pharmacy.dispense", "pharmacy.reports"); const tdb = db(ctx);
  const d = await tdb.dispensing.findFirst({ where: { id }, include: { items: { orderBy: { id: "asc" } }, patient: { select: { code: true, name: true } }, prescription: { select: { number: true } } } });
  if (!d) throw new AppError("NOT_FOUND", { message: "Dispensing not found." });
  const names = await userNames(tdb, [d.dispensedById]);
  const inv = d.invoiceId ? await tdb.invoice.findFirst({ where: { id: d.invoiceId }, select: { invoiceNumber: true, status: true, collectedMinor: true, totalMinor: true } }) : null;
  return {
    id: d.id as string, dispensingNumber: d.dispensingNumber as string, status: d.status as string, patientId: d.patientId as string, patientName: d.patient.name as string, patientCode: d.patient.code as string, prescriptionId: d.prescriptionId as string, prescriptionNumber: d.prescription.number as string | null,
    totalMinor: d.totalMinor as number, dispensedAt: iso(d.dispensedAt) as string, dispensedBy: names.get(d.dispensedById) ?? null, notes: d.notes as string | null, cancelReason: d.cancelReason as string | null,
    invoice: inv ? { id: d.invoiceId as string, invoiceNumber: inv.invoiceNumber as string, status: inv.status as string, collectedMinor: inv.collectedMinor as number, totalMinor: inv.totalMinor as number } : null,
    items: d.items.map((i: Record<string, any>) => ({ id: i.id as string, medicineName: i.medicineNameSnapshot as string, batchNumber: i.batchNumberSnapshot as string, expiry: i.expirySnapshot as string, prescribedQuantity: i.prescribedQuantity as number, dispensedQuantity: i.dispensedQuantity as number, returnedQuantity: i.returnedQuantity as number, unitPriceMinor: i.unitPriceMinor as number, taxRateBp: i.taxRateBp as number, taxMinor: i.taxMinor as number, totalMinor: i.totalMinor as number, status: i.status as string, batchOverrideReason: i.batchOverrideReason as string | null, notes: i.notes as string | null })) as DispensingLine[],
  };
}
export interface DispensingLine { id: string; medicineName: string; batchNumber: string; expiry: string; prescribedQuantity: number; dispensedQuantity: number; returnedQuantity: number; unitPriceMinor: number; taxRateBp: number; taxMinor: number; totalMinor: number; status: string; batchOverrideReason: string | null; notes: string | null }
export type DispensingDetail = Awaited<ReturnType<typeof getDispensing>>;

/* -------------------------------------------------------- returns -------------------------------------------------------- */
export async function requestReturn(ctx: TenantRequestContext, raw: unknown) {
  guard(ctx, "pharmacy.return_request");
  const v = parseOrThrow(returnRequestSchema, raw); const tdb = db(ctx); const settings = await loadPharmacySettings(tdb, ctx.tenantId); const today = await todayFor(ctx.tenantId);
  let medicineId = "", batchId = "", patientId: string | null = null;
  if (v.type === "PATIENT_RETURN") {
    if (!settings.allowPatientReturns) throw new AppError("CONFLICT", { message: "This clinic's policy doesn't accept returned medicines. A pharmacy admin can change this in pharmacy settings." });
    const di = await tdb.dispensingItem.findFirst({ where: { id: v.dispensingItemId }, include: { dispensing: { select: { patientId: true, status: true, dispensedAt: true } } } });
    if (!di || di.dispensing.status === "CANCELLED" || di.status !== "DISPENSED") throw new AppError("NOT_FOUND", { message: "That dispensed medicine wasn't found." });
    const age = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${di.dispensing.dispensedAt.toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000);
    if (age > settings.returnWindowDays) throw new AppError("CONFLICT", { message: `Returns are accepted within ${settings.returnWindowDays} days of dispensing.` });
    medicineId = di.medicineId; batchId = di.batchId; patientId = di.dispensing.patientId;
  } else {
    const b = await tdb.medicineBatch.findFirst({ where: { id: v.batchId }, select: { id: true, medicineId: true } });
    if (!b) throw new AppError("NOT_FOUND", { message: "That batch doesn't exist." });
    medicineId = b.medicineId; batchId = b.id;
  }
  const yr = today.slice(0, 4);
  const out = await tdb.$transaction(async (tx: Client) => {
    if (v.type === "PATIENT_RETURN") {
      const cur = await tx.dispensingItem.findFirst({ where: { id: v.dispensingItemId, tenantId: ctx.tenantId }, select: { dispensedQuantity: true, returnedQuantity: true } });
      if (!cur || cur.dispensedQuantity - cur.returnedQuantity < v.quantity) throw new AppError("VALIDATION_ERROR", { message: `Only ${cur ? cur.dispensedQuantity - cur.returnedQuantity : 0} units of this medicine can still be returned.`, fieldErrors: { quantity: "More than can be returned." } });
      const res = await tx.dispensingItem.updateMany({ where: { id: v.dispensingItemId, tenantId: ctx.tenantId, returnedQuantity: cur.returnedQuantity }, data: { returnedQuantity: { increment: v.quantity } } });
      if (res.count !== 1) throw new AppError("CONFLICT", { message: "Another return was just recorded for this medicine. Refresh and try again." });
    }
    const n = await nextCounter(tx, ctx.tenantId, `ret:${yr}`);
    return tx.medicineReturn.create({ data: { tenantId: ctx.tenantId, returnNumber: `RET-${yr}-${pad(n)}`, type: v.type, status: "REQUESTED", medicineId, batchId, quantity: v.quantity, reason: v.reason, patientId, dispensingItemId: v.dispensingItemId ?? null, notes: v.notes ?? null, requestedById: ctx.user.id }, select: { id: true, returnNumber: true } });
  });
  await audit(ctx, AUDIT_ACTIONS.RETURN_REQUESTED, "medicine_return", out.id, { number: out.returnNumber, type: v.type, quantity: v.quantity });
  return { id: out.id as string, returnNumber: out.returnNumber as string };
}
const RETURN_STEP: Record<string, { from: string; to: string }> = { approve: { from: "REQUESTED", to: "APPROVED" }, reject: { from: "REQUESTED", to: "REJECTED" }, receive: { from: "APPROVED", to: "RECEIVED" }, restock: { from: "RECEIVED", to: "RESTOCKED" }, dispose: { from: "RECEIVED", to: "DISPOSED" } };
/** REQUESTED → APPROVED → RECEIVED → RESTOCKED | DISPOSED (or REJECTED). A returned medicine only becomes sellable stock by an explicit, audited "restock". */
export async function returnAction(ctx: TenantRequestContext, id: string, raw: unknown) {
  guard(ctx, "pharmacy.return_approve");
  const v = parseOrThrow(returnActionSchema, raw); const tdb = db(ctx); const step = RETURN_STEP[v.action]; const today = await todayFor(ctx.tenantId);
  const cur = await tdb.medicineReturn.findFirst({ where: { id } });
  if (!cur) throw new AppError("NOT_FOUND", { message: "Return not found." });
  if (cur.type === "PURCHASE_RETURN") throw new AppError("CONFLICT", { message: "A return to a supplier is complete as soon as it is recorded." });
  if (cur.status !== step.from) throw new AppError("CONFLICT", { message: `This return is ${cur.status.toLowerCase()}; it can't be ${v.action}d now.` });
  if (v.action === "receive" && !v.condition) throw new AppError("VALIDATION_ERROR", { message: "Record the condition of the returned medicine.", fieldErrors: { condition: "Choose the condition." } });
  if (v.action === "reject" && !v.reason) throw new AppError("VALIDATION_ERROR", { message: "Give a reason for rejecting.", fieldErrors: { reason: "Give a reason." } });
  if (v.action === "restock") {
    const b = await tdb.medicineBatch.findFirst({ where: { id: cur.batchId }, select: { expiryDate: true, status: true } });
    if (cur.condition !== "SEALED") throw new AppError("CONFLICT", { message: "Only medicine received sealed and intact can be restocked. Dispose of it instead." });
    if (!b || b.expiryDate < today || b.status === "BLOCKED") throw new AppError("CONFLICT", { message: "This batch is expired or blocked, so the medicine can't go back into stock. Dispose of it instead." });
  }
  await tdb.$transaction(async (tx: Client) => {
    const r = await tx.medicineReturn.updateMany({ where: { id, tenantId: ctx.tenantId, status: step.from }, data: { status: step.to, ...(v.action === "approve" ? { approvedById: ctx.user.id } : {}), ...(v.action === "receive" ? { receivedById: ctx.user.id, condition: v.condition } : {}), ...(v.action === "restock" || v.action === "dispose" || v.action === "reject" ? { resolvedById: ctx.user.id } : {}), ...(v.reason ? { notes: v.reason } : {}) } });
    if (r.count !== 1) throw new AppError("CONFLICT", { message: "This return was just updated by someone else. Refresh and try again." });
    if (v.action === "reject" && cur.dispensingItemId) await tx.dispensingItem.updateMany({ where: { id: cur.dispensingItemId, tenantId: ctx.tenantId }, data: { returnedQuantity: { decrement: cur.quantity } } });
    if (v.action === "restock") await applyStock(tx, ctx, { batchId: cur.batchId, type: cur.type === "PATIENT_RETURN" ? "SALE_RETURN" : "RETURN", delta: cur.quantity, referenceType: "RETURN", referenceId: id, reason: cur.reason, bump: { returnedQuantity: cur.quantity } });
  });
  const act = v.action === "approve" ? AUDIT_ACTIONS.RETURN_APPROVED : v.action === "receive" ? AUDIT_ACTIONS.RETURN_RECEIVED : v.action === "reject" ? AUDIT_ACTIONS.RETURN_REJECTED : AUDIT_ACTIONS.RETURN_RESOLVED;
  await audit(ctx, act, "medicine_return", id, { number: cur.returnNumber, action: v.action, quantity: cur.quantity, condition: v.condition ?? null });
  return { status: step.to };
}
export interface ReturnRow { id: string; returnNumber: string; type: string; status: string; medicineName: string; batchNumber: string; quantity: number; reason: string; condition: string | null; reference: string | null; requestedBy: string | null; createdAt: string }
export async function listReturns(ctx: TenantRequestContext, q: { status?: string; type?: string; medicineId?: string; page?: number } = {}) {
  guard(ctx, "pharmacy.return_request", "pharmacy.return_approve", "pharmacy.reports"); const tdb = db(ctx); const page = Math.max(1, Math.floor(q.page ?? 1));
  const where: Record<string, unknown> = { ...(q.status ? { status: q.status } : {}), ...(q.type ? { type: q.type } : {}), ...(q.medicineId ? { medicineId: q.medicineId } : {}) };
  const [total, rows] = await Promise.all([tdb.medicineReturn.count({ where }), tdb.medicineReturn.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE })]);
  const meds = (await tdb.medicine.findMany({ where: { id: { in: [...new Set(rows.map((r: { medicineId: string }) => r.medicineId))] as string[] } }, select: { id: true, genericName: true, brandName: true, strength: true } })) as { id: string; genericName: string; brandName: string | null; strength: string | null }[];
  const batches = (await tdb.medicineBatch.findMany({ where: { id: { in: [...new Set(rows.map((r: { batchId: string }) => r.batchId))] as string[] } }, select: { id: true, batchNumber: true } })) as { id: string; batchNumber: string }[];
  const names = await userNames(tdb, rows.map((r: { requestedById: string }) => r.requestedById));
  return { rows: rows.map((r: Record<string, any>) => ({ id: r.id as string, returnNumber: r.returnNumber as string, type: r.type as string, status: r.status as string, medicineName: medName(meds.find((m) => m.id === r.medicineId) ?? { genericName: "—", brandName: null, strength: null }), batchNumber: batches.find((b) => b.id === r.batchId)?.batchNumber ?? "—", quantity: r.quantity as number, reason: r.reason as string, condition: r.condition as string | null, reference: r.reference as string | null, requestedBy: names.get(r.requestedById) ?? null, createdAt: iso(r.createdAt) as string })) as ReturnRow[], total: total as number, page, pageSize: PAGE };
}

/* ---------------------------------------------- Patient 360 pharmacy history ---------------------------------------------- */
export interface PatientPharmacyRow { id: string; dispensingNumber: string; status: string; dispensedAt: string; prescriptionNumber: string | null; totalMinor: number | null; invoiceNumber: string | null; invoiceStatus: string | null; items: { name: string; quantity: number; batch: string }[] }
export async function patientPharmacy(ctx: TenantRequestContext, patientId: string) {
  if (ctx.user.role === "SUPER_ADMIN" || !(ctx.permissions.has("pharmacy.dispense") || ctx.permissions.has("pharmacy.reports") || ctx.permissions.has("patients.clinical"))) throw new AppError("FORBIDDEN");
  const tdb = db(ctx);
  const p = await tdb.patient.findFirst({ where: { id: patientId }, select: { id: true } });
  if (!p) throw new AppError("NOT_FOUND", { message: "Patient not found." });
  const rows = (await tdb.dispensing.findMany({ where: { patientId, status: { not: "CANCELLED" } }, orderBy: { dispensedAt: "desc" }, take: 30, include: { items: { select: { medicineNameSnapshot: true, dispensedQuantity: true, batchNumberSnapshot: true } }, prescription: { select: { number: true } } } })) as Record<string, any>[];
  const invIds = rows.map((r) => r.invoiceId).filter(Boolean) as string[];
  const invs = invIds.length ? (await tdb.invoice.findMany({ where: { id: { in: invIds } }, select: { id: true, invoiceNumber: true, status: true } })) as { id: string; invoiceNumber: string; status: string }[] : [];
  return { rows: rows.map((r) => ({ id: r.id as string, dispensingNumber: r.dispensingNumber as string, status: r.status as string, dispensedAt: iso(r.dispensedAt) as string, prescriptionNumber: r.prescription.number as string | null, totalMinor: ctx.permissions.has("billing.view") || ctx.permissions.has("pharmacy.dispense") ? (r.totalMinor as number) : null, invoiceNumber: invs.find((i) => i.id === r.invoiceId)?.invoiceNumber ?? null, invoiceStatus: invs.find((i) => i.id === r.invoiceId)?.status ?? null, items: r.items.map((i: Record<string, any>) => ({ name: i.medicineNameSnapshot as string, quantity: i.dispensedQuantity as number, batch: i.batchNumberSnapshot as string })) })) as PatientPharmacyRow[] };
}
export async function pharmacyTimeline(ctx: TenantRequestContext, patientId: string) {
  if (ctx.user.role === "SUPER_ADMIN" || !(ctx.permissions.has("pharmacy.dispense") || ctx.permissions.has("patients.clinical"))) return [];
  const rows = (await db(ctx).dispensing.findMany({ where: { patientId, status: { not: "CANCELLED" } }, orderBy: { dispensedAt: "desc" }, take: 30, select: { id: true, dispensingNumber: true, status: true, dispensedAt: true } })) as { id: string; dispensingNumber: string; status: string; dispensedAt: Date }[];
  return rows.map((r) => ({ id: `ph-${r.id}`, type: "MEDICINE_DISPENSED", at: r.dispensedAt.toISOString(), title: r.status === "PARTIALLY_DISPENSED" ? "Medicines partly dispensed" : "Medicines dispensed", detail: r.dispensingNumber }));
}
