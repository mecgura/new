import { checkLimit, noteUsage } from "./entitlements";
import "server-only";
import { AppError } from "@/lib/errors";
import { canTransition, SLOT_HOLDING, type AppointmentStatus } from "@/lib/scheduling/states";
import { isUniqueViolation, randomCode, type Client } from "./clinic-shared";

/** The ONE place an appointment's status changes. Validates the transition and guards against concurrent edits. */
export async function setAppointmentStatus(client: Client, tenantId: string, id: string, from: AppointmentStatus, to: AppointmentStatus, data: Record<string, unknown> = {}) {
  if (!canTransition(from, to)) throw new AppError("CONFLICT", { message: `An appointment that is ${from.toLowerCase().replace(/_/g, " ")} can't be changed to ${to.toLowerCase().replace(/_/g, " ")}.` });
  const res = await client.appointment.updateMany({
    where: { id, tenantId, status: from },
    data: { status: to, ...(SLOT_HOLDING.includes(to) ? {} : { slotLock: null }), ...data },
  });
  if (res.count !== 1) throw new AppError("CONFLICT", { message: "This appointment was just changed by someone else. Refresh and try again." });
}

export const slotLockKey = (doctorUserId: string, startsAt: Date) => `${doctorUserId}|${startsAt.toISOString()}`;

export const SLOT_TAKEN = "Slot is no longer available. Please choose another time.";

/**
 * Inserts an appointment. The UNIQUE slotLock column makes the database itself reject a second booking of the same
 * doctor + slot, however many requests arrive at once; we turn that into a friendly conflict.
 */
export async function insertAppointment(client: Client, data: Record<string, unknown> & { tenantId: string; doctorUserId: string; startsAt: Date }) {
  // Plan limit. Callers pass a plain (non-transaction) client, so this separate read cannot deadlock.
  const lim = await checkLimit(data.tenantId, "maxAppointmentsPerMonth");
  if (!lim.allowed) throw data.source === "WEBSITE" || data.type === "ONLINE_APPOINTMENT" ? new AppError("CONFLICT", { message: "Online booking is unavailable right now. Please call the clinic." }) : new AppError("LIMIT_REACHED", { message: `${lim.reason} Upgrade your plan to add more.` });
  const slotLock = slotLockKey(data.doctorUserId, data.startsAt);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await client.appointment.create({ data: { ...data, slotLock, publicId: `AP-${randomCode(8)}` } });
      await noteUsage(data.tenantId, "maxAppointmentsPerMonth");
      return created;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // slot taken? (a publicId collision is astronomically unlikely and simply retried)
      const taken = await client.appointment.findFirst({ where: { slotLock }, select: { id: true } });
      if (taken) throw new AppError("CONFLICT", { message: SLOT_TAKEN });
    }
  }
  throw new AppError("INTERNAL");
}
