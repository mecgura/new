import { z } from "zod";
import { COMPLETION_OUTCOMES, CONTACT_METHODS, CONTACT_OUTCOMES, FOLLOWUP_TYPES, PRIORITIES, RECALL_FREQUENCIES } from "@/lib/followups/core";
import { DATE_RE, isValidDate } from "@/lib/scheduling/time";
import { requiredText } from "./fields";

const txt = (label: string, max: number) => z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).optional().transform((v) => (v ? v : undefined));
const id = (label: string) => z.string().trim().min(1).max(60, `${label} is invalid.`).optional().or(z.literal("").transform(() => undefined));
const date = (label: string) => z.string().regex(DATE_RE, `${label} must be a date.`).refine(isValidDate, `${label} is not a real date.`);
const code = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z_]{1,29}$/, "Use capital letters and underscores.");

export const followUpCreateSchema = z.object({
  patientId: id("Patient"), consultationId: id("Consultation"), prescriptionId: id("Prescription"), labReportId: id("Report"), doctorOrderId: id("Order"),
  type: z.enum(FOLLOWUP_TYPES, { error: "Choose a follow-up type." }).default("MANUAL_FOLLOW_UP"),
  title: requiredText("Title", { max: 120, min: 2 }), description: txt("Description", 500), doctorNotes: txt("Doctor note", 1000), notes: txt("Notes", 1000),
  dueDate: date("Due date").optional().or(z.literal("").transform(() => undefined)),
  afterDays: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(0).max(1825).optional()),
  preferredDate: date("Preferred date").optional().or(z.literal("").transform(() => undefined)),
  priority: z.enum(PRIORITIES).default("NORMAL"), assignedToId: id("Assignee"), doctorUserId: id("Doctor"),
}).superRefine((v, c) => {
  if (!v.dueDate && v.afterDays == null) c.addIssue({ code: "custom", path: ["dueDate"], message: "Choose a due date or a number of days." });
  if (!v.patientId && !v.consultationId && !v.prescriptionId && !v.labReportId && !v.doctorOrderId) c.addIssue({ code: "custom", path: ["patientId"], message: "Choose the patient." });
});
export const followUpEditSchema = z.object({ title: requiredText("Title", { max: 120, min: 2 }).optional(), description: txt("Description", 500).optional(), notes: txt("Notes", 1000).optional(), doctorNotes: txt("Doctor note", 1000).optional(), priority: z.enum(PRIORITIES).optional(), preferredDate: date("Preferred date").optional().or(z.literal("").transform(() => undefined)), doctorUserId: id("Doctor") });

export const followUpActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("assign"), assignedToId: z.string().trim().max(60).nullable().optional() }),
  z.object({ action: z.literal("reschedule"), dueDate: date("New date"), reason: requiredText("Reason", { max: 300, min: 2 }) }),
  z.object({ action: z.literal("complete"), outcome: code, notes: requiredText("Notes", { max: 500, min: 2 }), nextDueDate: date("Next date").optional().or(z.literal("").transform(() => undefined)), nextAfterDays: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(0).max(1825).optional()), nextTitle: txt("Next title", 120) }),
  z.object({ action: z.literal("cancel"), reason: requiredText("Reason", { max: 300, min: 2 }) }),
]);
export const contactSchema = z.object({ method: z.enum(CONTACT_METHODS, { error: "Choose how you contacted the patient." }), outcome: code, notes: txt("Notes", 500), nextAction: txt("Next action", 200), nextActionDate: date("Next action date").optional().or(z.literal("").transform(() => undefined)) });
export const completionBuiltin = COMPLETION_OUTCOMES as readonly string[];
export const contactBuiltin = CONTACT_OUTCOMES as readonly string[];

export const recallCreateSchema = z.object({
  patientId: z.string().trim().min(1, "Choose the patient."), doctorUserId: id("Doctor"), type: z.enum(FOLLOWUP_TYPES).default("ROUTINE_RECALL"),
  title: requiredText("Title", { max: 120, min: 2 }), dueDate: date("Due date"), notes: txt("Notes", 500),
  frequency: z.enum(RECALL_FREQUENCIES).default("ONE_TIME"), customMonths: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).max(60).optional()),
  maxOccurrences: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).max(12).optional()),
}).superRefine((v, c) => {
  if (v.frequency === "CUSTOM" && !v.customMonths) c.addIssue({ code: "custom", path: ["customMonths"], message: "Enter the interval in months." });
  if (v.frequency !== "ONE_TIME" && !v.maxOccurrences) c.addIssue({ code: "custom", path: ["maxOccurrences"], message: "Say how many times it may repeat (at most 12)." });
});
export const recallActionSchema = z.object({ action: z.enum(["createFollowUp", "complete", "cancel"], { error: "Unknown action." }), scheduleNext: z.boolean().optional() });

export const followUpSettingsSchema = z.object({
  createOnNoShow: z.boolean(), createOnCancellation: z.boolean(), recallCreatesFollowUp: z.boolean(), completeWhenVisitDone: z.boolean(),
  contactOutcomes: z.array(code).max(10).default([]), completionOutcomes: z.array(code).max(10).default([]),
});
