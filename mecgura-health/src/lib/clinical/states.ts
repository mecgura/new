/** Consultation / prescription / order state machines. Clients ask for ACTIONS; services validate the move. */
export const CONSULTATION_STATUSES = ["DRAFT", "IN_PROGRESS", "READY_FOR_REVIEW", "FINALIZED", "CANCELLED"] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];
export const CONSULTATION_TRANSITIONS: Record<ConsultationStatus, readonly ConsultationStatus[]> = {
  DRAFT: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["READY_FOR_REVIEW", "CANCELLED"],
  READY_FOR_REVIEW: ["IN_PROGRESS", "FINALIZED", "CANCELLED"],
  // a finalized consultation only changes through a controlled amendment (FINALIZED -> IN_PROGRESS with a reason, re-finalized as a new version)
  FINALIZED: ["IN_PROGRESS"],
  CANCELLED: [],
};
/** Statuses in which clinical content may be edited. */
export const EDITABLE: readonly ConsultationStatus[] = ["DRAFT", "IN_PROGRESS", "READY_FOR_REVIEW"];

export const ORDER_TYPES = ["MEDICATION", "INVESTIGATION", "DOCUMENT", "FOLLOW_UP", "OTHER"] as const;
export const ORDER_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [], CANCELLED: [],
};
/** Which order types each operational role may work on. */
export const OPERATIONAL_ORDER_TYPES: Record<string, readonly string[]> = {
  COMPOUNDER: ["MEDICATION", "DOCUMENT", "OTHER"],
  NURSE: ["MEDICATION", "INVESTIGATION", "OTHER"],
};

export const bmi = (weightKg?: number | null, heightCm?: number | null) => (weightKg && heightCm ? Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10 : null);
