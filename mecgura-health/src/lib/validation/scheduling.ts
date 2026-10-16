import { z } from "zod";
import { APPOINTMENT_SOURCES, APPOINTMENT_TYPES, PRIORITIES, QUEUE_TYPES, SELF_VISIT_TYPES } from "@/lib/scheduling/states";
import { isValidDate, parseHhmm } from "@/lib/scheduling/time";
import { GENDER_KEYS } from "@/lib/domain/constants";
import { email, phone, requiredText } from "./fields";

const text = (label: string, max: number) => z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).optional().transform((v) => (v ? v : undefined));
const optEmail = z.string().trim().max(254).optional().transform((v) => (v ? v : undefined)).pipe(email.optional());
const optGender = z.enum(GENDER_KEYS).optional().or(z.literal("").transform(() => undefined));
const dateStr = (label: string) => z.string({ error: `${label} is required.` }).refine(isValidDate, `Enter a valid ${label.toLowerCase()}.`);
const instant = z.string({ error: "Choose a time." }).refine((v) => !Number.isNaN(Date.parse(v)), "Choose a valid time.").transform((v) => new Date(v));
const optDob = z.string().trim().optional().transform((v) => (v ? v : undefined)).refine((v) => v === undefined || (isValidDate(v) && v <= new Date().toISOString().slice(0, 10)), "Enter a valid date of birth (not in the future).");
const optAge = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int("Age must be a whole number.").min(0).max(120, "Enter a valid age.").optional());

/* ------------------------------ patients ------------------------------ */
export const newPatientSchema = z.object({
  name: requiredText("Name", { max: 120, min: 2 }), phone, email: optEmail, gender: optGender, dateOfBirth: optDob, ageYears: optAge,
});
export type NewPatientInput = z.infer<typeof newPatientSchema>;

/** Linking an EXISTING patient requires proof the staff member is talking to the right person (not just an id). */
export const patientVerificationSchema = z.object({
  phoneLast4: z.string().trim().regex(/^\d{4}$/, "Enter the last 4 digits of the mobile number.").optional(),
  dateOfBirth: z.string().trim().optional().refine((v) => v === undefined || v === "" || isValidDate(v), "Enter a valid date of birth."),
  code: z.string().trim().max(20).optional(),
}).refine((v) => !!(v.phoneLast4 || v.dateOfBirth || v.code), { message: "Verify the patient: last 4 digits of mobile, date of birth, or patient ID." });

export const patientRefSchema = z.union([
  z.object({ patientId: z.string().min(1), verification: patientVerificationSchema }),
  /** staff opened this patient's profile (needs patients.view, checked on the server): no extra verification needed */
  z.object({ patientId: z.string().min(1), viaProfile: z.literal(true) }),
  z.object({ newPatient: newPatientSchema, allowDuplicate: z.boolean().default(false) }),
]);
export type PatientRef = z.infer<typeof patientRefSchema>;

export const patientSearchSchema = z.object({ q: z.string().trim().min(3, "Type at least 3 characters.").max(60) });

/* ---------------------------- appointments ---------------------------- */
export const publicBookingSchema = z.object({
  doctor: z.string().regex(/^[a-z0-9-]{1,80}$/, "Choose a doctor."),
  service: z.string().regex(/^[a-z0-9-]{1,80}$/).optional().or(z.literal("").transform(() => undefined)),
  startsAt: instant,
  name: requiredText("Full name", { max: 100, min: 2 }), phone, email: optEmail, gender: optGender, dateOfBirth: optDob, ageYears: optAge,
  reason: text("Reason", 300),
  consent: z.literal(true, { error: "Please tick the box to confirm your details." }),
  website_url: z.string().max(200).optional(),
});

const contact = { contactName: requiredText("Name", { max: 100, min: 2 }), contactPhone: phone };
export const staffAppointmentSchema = z.object({
  doctorUserId: z.string().min(1, "Choose a doctor."), startsAt: instant,
  type: z.enum(APPOINTMENT_TYPES).default("OPD"), source: z.enum(APPOINTMENT_SOURCES).default("RECEPTION"),
  serviceId: text("Service", 40), reason: text("Reason", 300), notes: text("Notes", 500),
  patient: patientRefSchema.optional(), followUpId: z.string().trim().max(60).optional().or(z.literal("").transform(() => undefined)),
  ...Object.fromEntries(Object.entries(contact).map(([k, v]) => [k, (v as z.ZodType).optional()])) as { contactName: z.ZodOptional<z.ZodString>; contactPhone: z.ZodOptional<z.ZodType<string>> },
}).superRefine((v, ctx) => { if (!v.patient && !v.contactName) ctx.addIssue({ code: "custom", path: ["patient"], message: "Choose or register the patient." }); });
export type StaffAppointmentInput = z.infer<typeof staffAppointmentSchema>;

const CANCEL_REASONS = ["PATIENT_REQUEST", "DOCTOR_UNAVAILABLE", "CLINIC_CLOSURE", "OTHER"] as const;
export const appointmentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("cancel"), reasonKind: z.enum(CANCEL_REASONS, { error: "Choose a reason." }), reason: text("Reason", 300) }),
  z.object({ action: z.literal("reschedule"), startsAt: instant, doctorUserId: z.string().optional() }),
  z.object({ action: z.literal("check-in"), patient: patientRefSchema.optional(), queueType: z.enum(QUEUE_TYPES).optional(), priority: z.enum(PRIORITIES).optional() }),
  z.object({ action: z.literal("no-show"), reason: text("Reason", 300) }),
  z.object({ action: z.literal("update"), notes: text("Notes", 500), reason: text("Reason", 300) }),
]);
export type AppointmentAction = z.infer<typeof appointmentActionSchema>;
export { CANCEL_REASONS };

export const calendarQuerySchema = z.object({
  from: dateStr("From date"), to: dateStr("To date"),
  doctorUserId: z.string().optional(), type: z.enum(APPOINTMENT_TYPES).optional(), status: z.string().optional(), serviceId: z.string().optional(),
}).refine((v) => v.from <= v.to, { message: "End date is before the start date.", path: ["to"] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 42, { message: "Choose a range of 6 weeks or less.", path: ["to"] });

/* --------------------------------- OPD --------------------------------- */
export const opdRegisterSchema = z.object({
  patient: patientRefSchema, doctorUserId: z.string().min(1, "Choose a doctor."),
  queueType: z.enum(QUEUE_TYPES).default("GENERAL"), visitType: z.enum(SELF_VISIT_TYPES).default("WALK_IN"),
  emergency: z.boolean().default(false), note: text("Note", 200),
});
export type OpdRegisterInput = z.infer<typeof opdRegisterSchema>;

export const QUEUE_ACTION_NAMES = ["call", "start", "hold", "resume", "requeue", "skip", "complete", "cancel", "recall", "priority", "reassign"] as const;
export const queueActionSchema = z.object({
  action: z.enum(QUEUE_ACTION_NAMES, { error: "Unknown action." }),
  reason: text("Reason", 200),
  priority: z.enum(PRIORITIES).optional(),
  doctorUserId: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.action === "priority" && !v.priority) ctx.addIssue({ code: "custom", path: ["priority"], message: "Choose a priority." });
  if (v.action === "reassign" && !v.doctorUserId) ctx.addIssue({ code: "custom", path: ["doctorUserId"], message: "Choose a doctor." });
});
export type QueueActionInput = z.infer<typeof queueActionSchema>;

/* ------------------------------ scheduling ------------------------------ */
const hh = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).");
export const scheduleSchema = z.object({
  slotMinutes: z.coerce.number().int().min(5, "Slots must be at least 5 minutes.").max(180).refine((n) => n % 5 === 0, "Use multiples of 5 minutes."),
  bufferMinutes: z.coerce.number().int().min(0).max(60).default(0),
  maxPerDay: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).max(500).optional()),
  onlineBooking: z.boolean().default(false),
  advanceDays: z.coerce.number().int().min(1).max(365).default(30),
  minNoticeMinutes: z.coerce.number().int().min(0).max(20160).default(60),
  roomLabel: text("Room label", 40),
  windows: z.array(z.object({ weekday: z.coerce.number().int().min(0).max(6), start: hh, end: hh })).max(28),
}).superRefine((v, ctx) => {
  const byDay = new Map<number, { s: number; e: number }[]>();
  v.windows.forEach((w, i) => {
    const s = parseHhmm(w.start), e = parseHhmm(w.end);
    if (s >= e) ctx.addIssue({ code: "custom", path: ["windows", i, "end"], message: "End time must be after the start time." });
    byDay.set(w.weekday, [...(byDay.get(w.weekday) ?? []), { s, e }]);
  });
  for (const [day, list] of byDay) {
    const sorted = [...list].sort((a, b) => a.s - b.s);
    if (sorted.length > 4) ctx.addIssue({ code: "custom", path: ["windows"], message: "At most 4 sessions per day." });
    sorted.forEach((w, i) => { if (i && w.s < sorted[i - 1].e) ctx.addIssue({ code: "custom", path: ["windows"], message: `Sessions overlap on day ${day}.` }); });
  }
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const BLOCK_KINDS = ["HOLIDAY", "LEAVE", "MEETING", "EMERGENCY", "CLOSURE", "OTHER"] as const;
export const blockedTimeSchema = z.object({
  doctorUserId: z.string().nullable().optional(),
  startDate: dateStr("Start date"), startTime: hh.default("00:00"), endDate: dateStr("End date"), endTime: hh.default("23:59"),
  kind: z.enum(BLOCK_KINDS).default("OTHER"), reason: text("Reason", 200),
}).refine((v) => `${v.startDate}T${v.startTime}` < `${v.endDate}T${v.endTime}`, { message: "The end must be after the start.", path: ["endDate"] });

export const opdSettingsSchema = z.object({
  tokenFormat: z.enum(["NUMERIC", "PREFIXED"]), tokenPad: z.coerce.number().int().min(1).max(4),
  prefixes: z.partialRecord(z.enum(QUEUE_TYPES), z.string().trim().toUpperCase().regex(/^[A-Z]{1,3}$/, "Use 1–3 letters.")).default({}),
  voiceAnnouncement: z.boolean(), showNextOnDisplay: z.boolean(), onlineTokens: z.boolean(),
  bookingMode: z.enum(["AUTO_CONFIRM", "REQUIRES_CONFIRMATION"]),
  rotateDisplayKey: z.boolean().optional(), displayEnabled: z.boolean(),
});
