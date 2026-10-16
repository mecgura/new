import { logger } from "@/lib/logger";

/**
 * Appointment events. Phase 11 turns them into patient communication (src/lib/communications/triggers.ts); other handlers may still subscribe.
 */
export type AppointmentEventName = "appointment.created" | "appointment.confirmed" | "appointment.rescheduled" | "appointment.cancelled" | "appointment.reminder_tomorrow" | "appointment.reminder_today";
export interface AppointmentEvent { name: AppointmentEventName; tenantId: string; appointmentId: string; at: Date; /** the staff member who did it, so they aren't notified about their own action */ actorUserId?: string }
type Handler = (e: AppointmentEvent) => void | Promise<void>;

const handlers = new Set<Handler>();
export function onAppointmentEvent(h: Handler) { handlers.add(h); return () => handlers.delete(h); }

export async function emitAppointmentEvent(name: AppointmentEventName, tenantId: string, appointmentId: string, actorUserId?: string) {
  const event = { name, tenantId, appointmentId, at: new Date(), actorUserId };
  logger.debug("appointment event", { name, appointmentId });
  // Phase 11: patient communication (queued asynchronously; can never fail the caller)
  try { const { onAppointmentEvent: comms } = await import("@/lib/notifications/events"); await comms(event); } catch (err) { logger.error("communication hook failed", { name, error: err }); }
  for (const h of handlers) { try { await h(event); } catch (err) { logger.error("appointment event handler failed", { name, error: err }); } }
}
