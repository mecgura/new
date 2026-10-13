import { keyRoute, needTenant, pageOf } from "@/lib/api/key-route";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
/** Appointments of the key's clinic only. No patient names, phones or reasons — just scheduling facts. Paginated (max 50). */
export const GET = keyRoute("appointments.read", async ({ req, principal }) => {
  const tenantId = needTenant(principal); const { page, size, skip, q } = pageOf(req);
  const from = q.get("from") ? new Date(q.get("from")!) : null; const to = q.get("to") ? new Date(q.get("to")!) : null;
  const range = { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lt: to } : {}) };
  const where = { tenantId, ...(Object.keys(range).length ? { startsAt: range } : {}) };
  const [total, rows] = await Promise.all([db.appointment.count({ where }), db.appointment.findMany({ where, orderBy: { startsAt: "asc" }, skip, take: size, select: { publicId: true, startsAt: true, endsAt: true, status: true, type: true, doctorUserId: true } })]);
  return { total, page, pageSize: size, rows };
});
