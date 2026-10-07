/** Controlled state machines. The frontend never sets a status: it asks for an ACTION; the service validates the transition. */

export const APPOINTMENT_TYPES = ["ONLINE_APPOINTMENT", "WALK_IN", "FOLLOW_UP", "EMERGENCY", "OPD", "PROCEDURE", "OTHER"] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];
export const APPOINTMENT_SOURCES = ["WEBSITE", "PHONE", "WALK_IN", "RECEPTION", "WHATSAPP", "REFERRAL", "OTHER"] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

export const APPOINTMENT_STATUSES = ["REQUESTED", "CONFIRMED", "CHECKED_IN", "WAITING", "CALLED", "IN_CONSULTATION", "COMPLETED", "CANCELLED", "NO_SHOW", "ON_HOLD", "SKIPPED"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  REQUESTED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["WAITING", "CANCELLED"],
  WAITING: ["CALLED", "ON_HOLD", "SKIPPED", "CANCELLED"],
  CALLED: ["IN_CONSULTATION", "WAITING", "ON_HOLD", "SKIPPED"],
  IN_CONSULTATION: ["COMPLETED", "ON_HOLD"],
  ON_HOLD: ["WAITING", "SKIPPED", "CANCELLED"],
  SKIPPED: ["WAITING", "CANCELLED", "NO_SHOW"],
  COMPLETED: [], CANCELLED: [], NO_SHOW: [],
};
/** Statuses that keep the doctor's slot occupied. CANCELLED and NO_SHOW free it. */
export const SLOT_HOLDING: readonly AppointmentStatus[] = APPOINTMENT_STATUSES.filter((s) => s !== "CANCELLED" && s !== "NO_SHOW");
/** Statuses an appointment can still be rescheduled/cancelled from (not yet in the live queue). */
export const PRE_VISIT: readonly AppointmentStatus[] = ["REQUESTED", "CONFIRMED"];
export const canTransition = (from: AppointmentStatus, to: AppointmentStatus) => APPOINTMENT_TRANSITIONS[from].includes(to);

export const OPD_STATUSES = ["WAITING", "CALLED", "IN_CONSULTATION", "COMPLETED", "ON_HOLD", "SKIPPED", "CANCELLED"] as const;
export type OpdStatus = (typeof OPD_STATUSES)[number];
export const OPD_TRANSITIONS: Record<OpdStatus, readonly OpdStatus[]> = {
  WAITING: ["CALLED", "ON_HOLD", "SKIPPED", "CANCELLED"],
  CALLED: ["IN_CONSULTATION", "WAITING", "ON_HOLD", "SKIPPED"],
  IN_CONSULTATION: ["COMPLETED", "ON_HOLD"],
  ON_HOLD: ["WAITING", "SKIPPED", "CANCELLED"],
  SKIPPED: ["WAITING", "CANCELLED"],
  COMPLETED: [], CANCELLED: [],
};
export const canVisitTransition = (from: OpdStatus, to: OpdStatus) => OPD_TRANSITIONS[from].includes(to);
export const ACTIVE_OPD: readonly OpdStatus[] = ["WAITING", "CALLED", "IN_CONSULTATION", "ON_HOLD", "SKIPPED"];

/** Queue actions staff can request, and the status each one moves a visit to. */
export const QUEUE_ACTIONS = { call: "CALLED", start: "IN_CONSULTATION", hold: "ON_HOLD", resume: "WAITING", requeue: "WAITING", skip: "SKIPPED", complete: "COMPLETED", cancel: "CANCELLED", recall: "WAITING" } as const;
export type QueueAction = keyof typeof QUEUE_ACTIONS;

export const QUEUE_TYPES = ["GENERAL", "FOLLOW_UP", "EMERGENCY", "PROCEDURE", "ONLINE_APPOINTMENT", "WALK_IN"] as const;
export type QueueType = (typeof QUEUE_TYPES)[number];
export const PRIORITIES = ["NORMAL", "HIGH", "EMERGENCY"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_RANK: Record<Priority, number> = { EMERGENCY: 0, HIGH: 1, NORMAL: 2 };

/** appointment status that mirrors a queue status */
export const VISIT_TO_APPOINTMENT: Record<OpdStatus, AppointmentStatus> = { WAITING: "WAITING", CALLED: "CALLED", IN_CONSULTATION: "IN_CONSULTATION", COMPLETED: "COMPLETED", ON_HOLD: "ON_HOLD", SKIPPED: "SKIPPED", CANCELLED: "CANCELLED" };

export const SELF_VISIT_TYPES = ["WALK_IN", "FOLLOW_UP", "EMERGENCY", "PROCEDURE", "OPD", "OTHER"] as const;

export interface QueueSortable { priority: string; queueSeq: number }
/** Emergency first, then high, then arrival order. Stable and deterministic. */
export function compareQueue(a: QueueSortable, b: QueueSortable): number {
  return (PRIORITY_RANK[a.priority as Priority] ?? 9) - (PRIORITY_RANK[b.priority as Priority] ?? 9) || a.queueSeq - b.queueSeq;
}

export function formatToken(opts: { format: string; pad: number; prefix: string; n: number }): string {
  const num = String(opts.n).padStart(opts.pad, "0");
  return opts.format === "PREFIXED" && opts.prefix ? `${opts.prefix}-${num}` : num;
}
