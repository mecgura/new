import { logger } from "@/lib/logger";

/**
 * Reminder hooks. Phase 3 only EMITS these events; no handler is registered, so nothing is sent.
 * (WhatsApp / SMS / email delivery belongs to a later phase: it will call `onAppointmentEvent`.)
 */
export type AppointmentEventName = "appointment.created" | "appointment.confirmed" | "appointment.rescheduled" | "appointment.cancelled" | "appointment.reminder_tomorrow" | "appointment.reminder_today";
export interface AppointmentEvent { name: AppointmentEventName; tenantId: string; appointmentId: string; at: Date }
type Handler = (e: AppointmentEvent) => void | Promise<void>;

const handlers = new Set<Handler>();
export function onAppointmentEvent(h: Handler) { handlers.add(h); return () => handlers.delete(h); }

export async function emitAppointmentEvent(name: AppointmentEventName, tenantId: string, appointmentId: string) {
  const event = { name, tenantId, appointmentId, at: new Date() };
  logger.debug("appointment event", { name, appointmentId });
  for (const h of handlers) { try { await h(event); } catch (err) { logger.error("appointment event handler failed", { name, error: err }); } }
}
