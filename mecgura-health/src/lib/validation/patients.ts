import { z } from "zod";
import { GENDER_KEYS } from "@/lib/domain/constants";
import { isValidDate } from "@/lib/scheduling/time";
import { email, phone, requiredText } from "./fields";

const txt = (label: string, max: number) => z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).optional().transform((v) => (v ? v : undefined));
const optEmail = z.string().trim().max(254).optional().transform((v) => (v ? v : undefined)).pipe(email.optional());
const optPhone = z.string().trim().optional().transform((v) => (v ? v : undefined)).pipe(phone.optional());
const optGender = z.enum(GENDER_KEYS).optional().or(z.literal("").transform(() => undefined));
const optDob = z.string().trim().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || (isValidDate(v) && v <= new Date().toISOString().slice(0, 10)), "Enter a valid date of birth (not in the future).");
const optAge = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int("Age must be a whole number.").min(0).max(120, "Enter a valid age.").optional());
const emptyToUndef = <T extends z.ZodType>(s: T) => z.union([z.literal("").transform(() => undefined), s]).optional();

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const MARITAL = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "OTHER"] as const;
export const PREF = ["ALLOWED", "NOT_ALLOWED", "UNKNOWN"] as const;
export const PATIENT_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;

/** Only what a clinic needs. Everything except name + mobile is optional. */
const detailFields = {
  name: requiredText("Full name", { max: 120, min: 2 }),
  preferredName: txt("Preferred name", 60),
  phone,
  alternatePhone: optPhone,
  email: optEmail,
  gender: optGender,
  dateOfBirth: optDob,
  ageYears: optAge,
  addressLine: txt("Address", 200), city: txt("City", 80), state: txt("State", 80), country: txt("Country", 80),
  pincode: z.string().trim().max(12).regex(/^[A-Za-z0-9 -]*$/, "Enter a valid postal code.").optional().transform((v) => (v ? v : undefined)),
  bloodGroup: emptyToUndef(z.enum(BLOOD_GROUPS, { error: "Choose a blood group." })),
  maritalStatus: emptyToUndef(z.enum(MARITAL)),
  occupation: txt("Occupation", 80),
  emergencyContactName: txt("Emergency contact name", 100), emergencyContactRelation: txt("Relation", 40), emergencyContactPhone: optPhone,
  prefPhone: z.enum(PREF).default("UNKNOWN"), prefWhatsapp: z.enum(PREF).default("UNKNOWN"), prefSms: z.enum(PREF).default("UNKNOWN"), prefEmail: z.enum(PREF).default("UNKNOWN"),
};
const emergencyRule = (v: { emergencyContactName?: string; emergencyContactPhone?: string }, ctx: z.RefinementCtx) => {
  if (v.emergencyContactPhone && !v.emergencyContactName) ctx.addIssue({ code: "custom", path: ["emergencyContactName"], message: "Enter the emergency contact's name." });
  if (v.emergencyContactName && !v.emergencyContactPhone) ctx.addIssue({ code: "custom", path: ["emergencyContactPhone"], message: "Enter the emergency contact's phone number." });
};

export const patientRegisterSchema = z.object({
  ...detailFields,
  /** the clinic confirms the patient was shown its privacy notice */
  privacyAcknowledged: z.boolean().default(false),
  /** user chose "continue new registration" after seeing possible matches */
  allowDuplicate: z.boolean().default(false),
}).superRefine(emergencyRule);
export type PatientRegisterInput = z.infer<typeof patientRegisterSchema>;

export const patientUpdateSchema = z.object(detailFields).superRefine(emergencyRule);
export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;

export const patientListSchema = z.object({
  q: z.string().trim().max(60).optional().transform((v) => (v ? v : undefined)),
  status: z.enum([...PATIENT_STATUSES, "ALL"]).default("ACTIVE"),
  recent: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const TIMELINE_FILTERS = ["all", "appointments", "opd", "clinical", "documents", "reports", "billing", "pharmacy", "followup"] as const;
export const timelineQuerySchema = z.object({ filter: z.enum(TIMELINE_FILTERS).default("all"), page: z.coerce.number().int().min(1).max(500).default(1) });

export const archiveSchema = z.object({ reason: txt("Reason", 200) });

/* ------------------------------- clinical records ------------------------------- */
export const SEVERITIES = ["MILD", "MODERATE", "SEVERE", "UNKNOWN"] as const;
export const ALLERGY_STATUSES = ["ACTIVE", "INACTIVE", "UNKNOWN"] as const;
export const allergySchema = z.object({
  allergen: requiredText("Allergen", { max: 100, min: 2 }), reaction: txt("Reaction", 200),
  severity: z.enum(SEVERITIES).default("UNKNOWN"), notes: txt("Notes", 500), status: z.enum(ALLERGY_STATUSES).default("ACTIVE"),
});

export const MED_SOURCES = ["PATIENT_REPORTED", "CLINICIAN_RECORDED", "OTHER"] as const;
export const medicationSchema = z.object({
  name: requiredText("Medicine name", { max: 120, min: 2 }), strength: txt("Strength", 60), frequency: txt("Frequency", 80), notes: txt("Notes", 500),
  source: z.enum(MED_SOURCES).default("PATIENT_REPORTED"), active: z.boolean().default(true),
});

export const HISTORY_CATEGORIES = ["CONDITION", "SURGERY", "HOSPITALIZATION", "CHRONIC_CONDITION", "PROCEDURE", "OTHER"] as const;
export const HISTORY_STATUSES = ["ACTIVE", "RESOLVED", "UNKNOWN"] as const;
export const historySchema = z.object({
  category: z.enum(HISTORY_CATEGORIES, { error: "Choose a category." }), title: requiredText("Title", { max: 150, min: 2 }), description: txt("Description", 1000),
  occurredOn: z.string().trim().max(10).regex(/^(\d{4}(-\d{2})?(-\d{2})?)?$/, "Use a year (2019) or a date (2019-03-15).").optional().transform((v) => (v ? v : undefined)),
  status: z.enum(HISTORY_STATUSES).default("UNKNOWN"), notes: txt("Notes", 500),
});

export const FAMILY_RELATIONS = ["FATHER", "MOTHER", "SIBLING", "GRANDPARENT", "CHILD", "OTHER"] as const;
export const familyHistorySchema = z.object({ relation: z.enum(FAMILY_RELATIONS, { error: "Choose a relation." }), condition: requiredText("Condition", { max: 150, min: 2 }), notes: txt("Notes", 500) });

export const NOTE_KINDS = ["GENERAL", "RECEPTION", "CLINICAL"] as const;
export const noteSchema = z.object({ kind: z.enum(NOTE_KINDS).default("GENERAL"), content: requiredText("Note", { max: 2000, min: 1 }) });

export const CONSENT_TYPES = ["PRIVACY", "COMMUNICATION", "DATA_PROCESSING"] as const;
export const consentSchema = z.object({ type: z.enum(CONSENT_TYPES, { error: "Choose a consent type." }), status: z.enum(["GRANTED", "WITHDRAWN"]), version: z.string().trim().min(1).max(40).default("clinic-notice-v1"), note: txt("Note", 200) });

export const familyLinkSchema = z.object({ otherPatientId: z.string().min(1, "Choose a patient."), relation: txt("Relation", 40) });
