import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { externalMedicineSource, type MedicineHit } from "@/lib/integrations/medicines";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { medicineSchema } from "@/lib/validation/clinical";
import type { Client } from "./clinic-shared";
import { containsCI } from "./shared";

const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;

/**
 * Medicine search. Sources: an external medicine API/database (none configured) and the clinic's own imported list (empty until
 * the clinic adds real entries). Nothing is seeded or invented; with no source the UI says so and the doctor types manually.
 */
export async function searchMedicines(ctx: TenantRequestContext, q: string) {
  if (ctx.user.role === "SUPER_ADMIN" || !(ctx.permissions.has("prescription.create") || ctx.permissions.has("prescription.edit"))) throw new AppError("FORBIDDEN");
  const lim = await rateLimit(`msearch:${ctx.user.id}`, { limit: 240, windowMs: 60_000 });
  if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const text = q.trim().slice(0, 60);
  const total = await db(ctx).medicineReference.count({ where: { active: true } });
  const configured = total > 0 || !!externalMedicineSource;
  if (text.length < 2 || !configured) return { configured, source: externalMedicineSource?.name ?? (total > 0 ? "clinic list" : null), items: [] as (MedicineHit & { id?: string })[] };
  const local = await db(ctx).medicineReference.findMany({ where: { active: true, OR: [{ name: containsCI(text) }, { genericName: containsCI(text) }, { brandName: containsCI(text) }, { strength: containsCI(text) }] }, orderBy: { name: "asc" }, take: 15 });
  const items: (MedicineHit & { id?: string })[] = local.map((m: { id: string } & MedicineHit) => ({ id: m.id, name: m.name, genericName: m.genericName, brandName: m.brandName, strength: m.strength, form: m.form }));
  if (externalMedicineSource) { try { items.push(...(await externalMedicineSource.search(text, 15))); } catch { throw new AppError("INTERNAL", { message: "The medicine database isn't reachable right now. You can still type the medicine manually." }); } }
  return { configured, source: externalMedicineSource?.name ?? "clinic list", items: items.slice(0, 20) };
}

export async function addMedicine(ctx: TenantRequestContext, raw: unknown) {
  if (!ctx.permissions.has("medicines.manage") || ctx.user.role === "SUPER_ADMIN") throw new AppError("FORBIDDEN");
  const m = parseOrThrow(medicineSchema, raw);
  const row = await db(ctx).medicineReference.create({ data: { tenantId: ctx.tenantId, name: m.name, genericName: m.genericName ?? null, brandName: m.brandName ?? null, strength: m.strength ?? null, form: m.form ?? null } });
  await recordAudit({ action: AUDIT_ACTIONS.MEDICINE_LIST_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "medicine_reference", entityId: row.id, metadata: { change: "added" } });
  return { id: row.id as string };
}
