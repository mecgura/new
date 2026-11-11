import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getSlots } from "@/lib/services/availability";

export const dynamic = "force-dynamic";
/** Staff view of a doctor's free slots for one day (computed server-side, tenant-checked). */
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "appointments.view" }, async ({ req, ctx }) => {
  const sp = new URL(req.url).searchParams;
  const doctor = sp.get("doctorUserId"), date = sp.get("date");
  if (!doctor || !date) throw new AppError("VALIDATION_ERROR", { message: "Choose a doctor and a date." });
  const exceptId = sp.get("except") ?? undefined;
  const r = await getSlots(ctx.tenantId, doctor, date, "staff", new Date(), exceptId);
  return { tz: r.tz, reason: r.reason, message: r.message, slots: r.slots };
});
