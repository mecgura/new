import { z } from "zod";
import { isValidDate } from "@/lib/scheduling/time";
import { ORDER_TYPES } from "@/lib/clinical/states";
import { requiredText } from "./fields";

const txt = (label: string, max: number) => z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).optional().transform((v) => (v ? v : undefined));
const num = (label: string, min: number, max: number, int = false) => z.preprocess((v) => (v === "" || v === null ? undefined : v), (int ? z.coerce.number().int(`${label} must be a whole number.`) : z.coerce.number({ error: `${label} must be a number.` })).min(min, `${label} must be ${min} or more.`).max(max, `${label} must be ${max} or less.`).optional());
const dateStr = z.string().trim().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || isValidDate(v), "Enter a valid date.");

/* ------------------------------ consultation content (autosave patch) ------------------------------ */
export const complaintSchema = z.object({ text: requiredText("Complaint", { max: 200, min: 1 }), duration: txt("Duration", 60), severity: txt("Severity", 40), notes: txt("Notes", 500) });
export const symptomSchema = z.object({ name: requiredText("Symptom", { max: 120, min: 1 }), duration: txt("Duration", 60), severity: txt("Severity", 40), onset: txt("Onset", 60), notes: txt("Notes", 500) });
export const HISTORY_KEYS = ["hpi", "pastMedical", "surgical", "family", "medication", "allergy", "social", "other"] as const;
export const EXAM_KEYS = ["general", "respiratory", "cardiovascular", "abdomen", "neurological", "other"] as const;
const sections = <K extends readonly string[]>(keys: K) => z.object(Object.fromEntries(keys.map((k) => [k, txt(k, 4000)])) as Record<K[number], ReturnType<typeof txt>>);
export const consultationPatchSchema = z.object({
  rev: z.number().int().min(0),
  chiefComplaints: z.array(complaintSchema).max(20).optional(),
  symptoms: z.array(symptomSchema).max(40).optional(),
  history: sections(HISTORY_KEYS).optional(),
  examination: sections(EXAM_KEYS).extend({ custom: z.array(z.object({ title: requiredText("Title", { max: 60, min: 1 }), text: txt("Text", 4000) })).max(10).optional() }).optional(),
  assessment: txt("Assessment", 4000), impression: txt("Impression", 2000), differential: txt("Differential", 2000), assessmentNotes: txt("Notes", 2000),
  clinicalNotes: txt("Clinical notes", 8000), advice: txt("Advice", 4000),
  followUpRequired: z.boolean().optional(), followUpAfterDays: num("Follow-up days", 1, 730, true), followUpDate: dateStr, followUpNotes: txt("Follow-up notes", 1000),
});
export type ConsultationPatch = z.infer<typeof consultationPatchSchema>;

export const consultationActionSchema = z.object({
  action: z.enum(["review", "edit", "finalize", "cancel", "amend"], { error: "Unknown action." }),
  reason: txt("Reason", 300),
  /** doctor's explicit confirmation on the review screen */
  confirm: z.boolean().optional(),
});

/* ----------------------------------------------- vitals ----------------------------------------------- */
export const vitalsSchema = z.object({
  systolic: num("Systolic", 40, 300, true), diastolic: num("Diastolic", 20, 200, true), pulse: num("Pulse", 20, 250, true),
  temperature: num("Temperature", 20, 115), tempUnit: z.enum(["F", "C"]).default("F"),
  spo2: num("SpO2", 30, 100, true), respRate: num("Respiratory rate", 4, 80, true),
  weightKg: num("Weight", 0.3, 400), heightCm: num("Height", 20, 260),
  bloodSugar: num("Blood sugar", 10, 1500), sugarType: z.enum(["FASTING", "RANDOM", "PRE_MEAL", "POST_MEAL"]).optional().or(z.literal("").transform(() => undefined)),
  painScore: num("Pain score", 0, 10, true), notes: txt("Notes", 300),
}).superRefine((v, ctx) => {
  const any = [v.systolic, v.diastolic, v.pulse, v.temperature, v.spo2, v.respRate, v.weightKg, v.heightCm, v.bloodSugar, v.painScore].some((x) => x !== undefined);
  if (!any) ctx.addIssue({ code: "custom", path: ["_form"], message: "Enter at least one measurement." });
  if ((v.systolic === undefined) !== (v.diastolic === undefined)) ctx.addIssue({ code: "custom", path: [v.systolic === undefined ? "systolic" : "diastolic"], message: "Enter both blood pressure values." });
  if (v.systolic !== undefined && v.diastolic !== undefined && v.diastolic >= v.systolic) ctx.addIssue({ code: "custom", path: ["diastolic"], message: "Diastolic must be lower than systolic." });
  if (v.temperature !== undefined) { const f = v.tempUnit === "F"; if (f ? v.temperature < 70 || v.temperature > 115 : v.temperature < 20 || v.temperature > 46) ctx.addIssue({ code: "custom", path: ["temperature"], message: "Check the temperature and its unit." }); }
  if (v.sugarType && v.bloodSugar === undefined) ctx.addIssue({ code: "custom", path: ["bloodSugar"], message: "Enter the blood sugar value." });
});
export type VitalsInput = z.infer<typeof vitalsSchema>;

/* --------------------------------------------- diagnosis --------------------------------------------- */
export const diagnosisSchema = z.object({
  name: requiredText("Diagnosis", { max: 200, min: 2 }), code: txt("Code", 20), codeSystem: txt("Code system", 20),
  type: z.enum(["PRIMARY", "SECONDARY"]).default("SECONDARY"), notes: txt("Notes", 1000),
});

/* ------------------------------------------- prescription ------------------------------------------- */
export const FOOD = ["BEFORE_FOOD", "AFTER_FOOD", "WITH_FOOD", "ANYTIME"] as const;
export const prescriptionItemSchema = z.object({
  name: requiredText("Medicine name", { max: 150, min: 2 }), genericName: txt("Generic name", 150), brandName: txt("Brand name", 150), strength: txt("Strength", 60),
  dose: requiredText("Dose", { max: 80, min: 1 }), route: txt("Route", 40), frequency: requiredText("Frequency", { max: 80, min: 1 }),
  morning: z.boolean().default(false), afternoon: z.boolean().default(false), evening: z.boolean().default(false), night: z.boolean().default(false),
  foodTiming: z.enum(FOOD).optional().or(z.literal("").transform(() => undefined)),
  durationDays: num("Duration", 1, 3650, true), quantity: num("Quantity", 0.01, 100000), quantityUnit: txt("Unit", 30),
  startDate: dateStr, endDate: dateStr, instructions: txt("Instructions", 500), medicineRefId: txt("Medicine ref", 40),
}).superRefine((v, ctx) => { if (v.startDate && v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date is before the start date." }); });
export const prescriptionSaveSchema = z.object({ items: z.array(prescriptionItemSchema).max(30, "A prescription can have at most 30 medicines.") });
export const prescriptionActionSchema = z.object({ action: z.enum(["review", "edit", "finalize", "amend"], { error: "Unknown action." }), confirm: z.boolean().optional(), reason: txt("Reason", 300) });
export type PrescriptionItemInput = z.infer<typeof prescriptionItemSchema>;

/* ---------------------------------------------- orders ---------------------------------------------- */
export const orderCreateSchema = z.object({
  type: z.enum(ORDER_TYPES, { error: "Choose an order type." }), title: requiredText("Title", { max: 150, min: 2 }), description: txt("Description", 1000),
  priority: z.enum(["NORMAL", "HIGH", "URGENT"]).default("NORMAL"), assignedToId: txt("Assignee", 40),
});
export const orderUpdateSchema = z.object({ status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"], { error: "Choose a status." }) });

/* -------------------------------------------- templates / medicines -------------------------------------------- */
export const templateSchema = z.object({
  name: requiredText("Template name", { max: 60, min: 2 }),
  content: z.object({ chiefComplaint: txt("Chief complaint", 500), history: txt("History", 2000), examination: txt("Examination", 2000), assessment: txt("Assessment", 2000), advice: txt("Advice", 2000), clinicalNotes: txt("Notes", 4000) }),
});
export const medicineSchema = z.object({ name: requiredText("Name", { max: 150, min: 2 }), genericName: txt("Generic", 150), brandName: txt("Brand", 150), strength: txt("Strength", 60), form: txt("Form", 40) });
