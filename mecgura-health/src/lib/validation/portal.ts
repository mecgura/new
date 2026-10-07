import { z } from "zod";
import { DATE_RE, isValidDate } from "@/lib/scheduling/time";
import { password } from "./fields";
import { normalizeIdentifier } from "./schemas";
import { requiredText } from "./fields";

const txt = (label: string, max: number) => z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).nullish().transform((v) => (v ? v : undefined));
const date = (label: string) => z.string().regex(DATE_RE, `${label} must be a date.`).refine(isValidDate, `${label} is not a real date.`);

export const portalLoginSchema = z.object({
  clinic: z.string().trim().max(60).optional().or(z.literal("").transform(() => undefined)),
  identifier: z.string({ error: "Enter your email or mobile number." }).trim().min(1, "Enter your email or mobile number.").max(254).refine((v) => normalizeIdentifier(v) !== null, "Enter a valid email address or 10-digit mobile number."),
  password: z.string({ error: "Password is required." }).min(1, "Password is required.").max(128),
});
export const activateSchema = z.object({
  clinic: z.string().trim().max(60).optional().or(z.literal("").transform(() => undefined)),
  code: z.string({ error: "Enter the activation code." }).trim().toUpperCase().regex(/^[A-Z2-9]{5}-?[A-Z2-9]{5}$/, "That doesn't look like an activation code."),
  identifier: z.string({ error: "Enter your email or mobile number." }).trim().min(1, "Enter your email or mobile number.").max(254).refine((v) => normalizeIdentifier(v) !== null, "Enter a valid email address or 10-digit mobile number."),
  password, confirm: z.string(), acceptPrivacy: z.literal(true, { error: "Please accept the privacy notice to continue." }),
}).refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match." });
export const changePasswordSchema = z.object({ current: z.string().min(1, "Enter your current password.").max(128), next: password, confirm: z.string() }).refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Passwords do not match." }).refine((v) => v.next !== v.current, { path: ["next"], message: "Choose a password you haven't used here." });

const ID = z.string().trim().min(1).max(60);
export const bookSchema = z.object({ doctorId: ID, startsAt: z.coerce.date({ error: "Choose a time slot." }), reason: txt("Reason", 300), serviceId: ID.nullish().transform((v) => v ?? undefined) });
export const rescheduleSchema = z.object({ startsAt: z.coerce.date({ error: "Choose a time slot." }), doctorId: ID.nullish().transform((v) => v ?? undefined) });
export const cancelSchema = z.object({ reason: txt("Reason", 200) });

export const profileUpdateSchema = z.object({
  preferredName: txt("Preferred name", 80), email: z.string().trim().max(120).email("Enter a valid email.").nullish().or(z.literal("")).transform((v) => v || undefined),
  alternatePhone: txt("Alternate phone", 20), addressLine: txt("Address", 200), city: txt("City", 80), state: txt("State", 80), country: txt("Country", 80), pincode: txt("Pincode", 12),
  emergencyContactName: txt("Emergency contact name", 80), emergencyContactRelation: txt("Relation", 40), emergencyContactPhone: txt("Emergency contact phone", 20),
}).partial();
export const CORRECTABLE_FIELDS = ["name", "phone", "email", "dateOfBirth", "gender", "addressLine", "city", "state", "pincode", "bloodGroup"] as const;
export const correctionSchema = z.object({
  kind: z.enum(["PROFILE_CORRECTION", "MEDICAL_CORRECTION", "SUPPORT"], { error: "Choose a request type." }),
  field: z.string().trim().max(40).nullish().transform((v) => v || undefined), requestedValue: txt("Requested value", 300), reason: requiredText("Reason", { max: 500, min: 3 }),
}).superRefine((v, c) => {
  if (v.kind === "PROFILE_CORRECTION") { if (!v.field || !(CORRECTABLE_FIELDS as readonly string[]).includes(v.field)) c.addIssue({ code: "custom", path: ["field"], message: "Choose the detail to correct." }); if (!v.requestedValue) c.addIssue({ code: "custom", path: ["requestedValue"], message: "Enter the correct value." }); }
});
export const deactivationSchema = z.object({ reason: requiredText("Reason", { max: 500, min: 3 }) });

export const prefsSchema = z.object({
  categories: z.object({ appointments: z.boolean(), followUps: z.boolean(), billing: z.boolean(), reports: z.boolean(), general: z.boolean() }).partial().optional(),
  channels: z.object({ email: z.enum(["ALLOWED", "NOT_ALLOWED"]), sms: z.enum(["ALLOWED", "NOT_ALLOWED"]), whatsapp: z.enum(["ALLOWED", "NOT_ALLOWED"]), phone: z.enum(["ALLOWED", "NOT_ALLOWED"]) }).partial().optional(),
});
export const consentSchema = z.object({ type: z.enum(["PRIVACY", "COMMUNICATION", "DATA_PROCESSING"], { error: "Unknown consent." }), granted: z.boolean() });

export const portalSettingsSchema = z.object({
  enabled: z.boolean(), allowBooking: z.boolean(), allowCancel: z.boolean(), allowReschedule: z.boolean(), changeCutoffHours: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(0).max(168)),
  showDiagnoses: z.boolean(), supportNote: txt("Support note", 300), privacyNotice: txt("Privacy notice", 3000), consentVersion: z.string().trim().min(1).max(20).default("v1"),
  editableFields: z.array(z.enum(["preferredName", "email", "alternatePhone", "addressLine", "city", "state", "country", "pincode", "emergencyContactName", "emergencyContactRelation", "emergencyContactPhone"])).max(20),
});
export const requestReviewSchema = z.object({ action: z.enum(["start", "approve", "reject", "apply"], { error: "Unknown action." }), note: txt("Note", 500) });
export { date as portalDate };
