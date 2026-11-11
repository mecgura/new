import { StatusBadge, type Tone } from "@/components/ui";

export const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "Requested", CONFIRMED: "Confirmed", CHECKED_IN: "Checked in", WAITING: "Waiting", CALLED: "Called", IN_CONSULTATION: "With doctor",
  COMPLETED: "Completed", CANCELLED: "Cancelled", NO_SHOW: "No-show", ON_HOLD: "On hold", SKIPPED: "Skipped",
};
export const STATUS_TONE: Record<string, Tone> = {
  REQUESTED: "warning", CONFIRMED: "info", CHECKED_IN: "primary", WAITING: "primary", CALLED: "success", IN_CONSULTATION: "success",
  COMPLETED: "neutral", CANCELLED: "danger", NO_SHOW: "danger", ON_HOLD: "warning", SKIPPED: "warning",
};
export const TYPE_LABEL: Record<string, string> = {
  ONLINE_APPOINTMENT: "Online booking", WALK_IN: "Walk-in", FOLLOW_UP: "Follow-up", EMERGENCY: "Emergency", OPD: "OPD", PROCEDURE: "Procedure", OTHER: "Other",
};
export const PRIORITY_LABEL: Record<string, string> = { NORMAL: "Normal", HIGH: "High priority", EMERGENCY: "Emergency" };
export const CANCEL_REASON_LABEL: Record<string, string> = { PATIENT_REQUEST: "Patient asked to cancel", DOCTOR_UNAVAILABLE: "Doctor unavailable", CLINIC_CLOSURE: "Clinic closed", OTHER: "Other" };

export const AppointmentStatusBadge = ({ status }: { status: string }) => <StatusBadge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</StatusBadge>;
export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "NORMAL") return null;
  return <StatusBadge tone={priority === "EMERGENCY" ? "emergency" : "warning"}>{priority === "EMERGENCY" ? "Emergency" : "High priority"}</StatusBadge>;
}
