import { z } from "zod";
import { CLINIC_TYPE_KEYS, GENDER_KEYS, RESERVED_LABELS, TENANT_STATUS_KEYS, TIMEZONES } from "@/lib/domain/constants";
import { ROLES } from "@/lib/permissions/constants";
import { TENANT_ASSIGNABLE_ROLES } from "@/lib/permissions/roles";
import { brandContrastIssues } from "@/theme/contrast";
import { email, hexColor, optionalPhone, optionalText, phone, requiredText, slug } from "./fields";

const optionalEmail = z.string().trim().toLowerCase().optional().transform((v) => (v ? v : undefined)).pipe(z.email("Enter a valid email address.").optional());
const label = slug.refine((v) => !RESERVED_LABELS.includes(v), "This name is reserved. Choose another.");

/** Hostname like drsharma.com / clinic.example.org (no scheme, no path, no port). */
export const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, "Enter a domain like clinic.com (no https:// or path).");

export const clinicProfileFields = {
  name: requiredText("Clinic name", { max: 120 }),
  legalName: optionalText("Legal name", 160),
  clinicType: z.enum(CLINIC_TYPE_KEYS, { error: "Choose a clinic type." }),
  contactEmail: optionalEmail,
  contactPhone: optionalPhone,
  alternatePhone: optionalPhone,
  address: optionalText("Address", 300),
  city: optionalText("City", 80),
  state: optionalText("State", 80),
  country: requiredText("Country", { max: 80 }).default("India"),
  pincode: z.string().trim().regex(/^[0-9A-Za-z -]{3,10}$/, "Enter a valid postal code.").optional().or(z.literal("").transform(() => undefined)),
  timezone: z.enum(TIMEZONES, { error: "Choose a timezone." }),
};

export const clinicProfileSchema = z.object(clinicProfileFields);
export type ClinicProfileInput = z.infer<typeof clinicProfileSchema>;

export const brandingSchema = z
  .object({ primaryColor: hexColor, secondaryColor: hexColor, accentColor: hexColor })
  .superRefine((v, ctx) => {
    const issues = brandContrastIssues({ primary: v.primaryColor, secondary: v.secondaryColor, accent: v.accentColor });
    for (const [k, msg] of Object.entries(issues)) ctx.addIssue({ code: "custom", path: [`${k}Color`], message: msg });
  });
export type BrandingInput = z.infer<typeof brandingSchema>;

export const domainSchema = z.object({
  subdomain: label.optional().or(z.literal("").transform(() => undefined)),
  customDomain: hostname.optional().or(z.literal("").transform(() => undefined)),
  websiteEnabled: z.boolean().optional(),
});

export const tenantStatusSchema = z.object({ status: z.enum(TENANT_STATUS_KEYS) });

const roleKey = z.enum(ROLES);
export const tenantRoleKey = z.enum(TENANT_ASSIGNABLE_ROLES as [string, ...string[]], { error: "Choose a role." });

const optionalInt = (label: string, max: number) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number({ error: `${label} must be a number.` }).int(`${label} must be a whole number.`).min(0, `${label} can't be negative.`).max(max, `${label} is too large.`).optional());

const doctorFields = {
  qualification: optionalText("Qualification", 200),
  specialization: optionalText("Specialization", 120),
  registrationNumber: optionalText("Registration number", 60),
  experienceYears: optionalInt("Experience", 70),
  gender: z.enum(GENDER_KEYS).optional().or(z.literal("").transform(() => undefined)),
  bio: optionalText("Bio", 1500),
  consultationFee: optionalInt("Consultation fee", 1_000_000),
};
const staffFields = { employeeRef: optionalText("Employee ID", 40), designation: optionalText("Designation", 80) };

export const userCreateSchema = z.object({
  name: requiredText("Name", { max: 120 }),
  email,
  phone: optionalPhone,
  role: tenantRoleKey,
  grants: z.array(z.string()).default([]),
  ...doctorFields,
  ...staffFields,
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  name: requiredText("Name", { max: 120 }).optional(),
  phone: optionalPhone,
  role: tenantRoleKey.optional(),
  grants: z.array(z.string()).optional(),
  ...doctorFields,
  ...staffFields,
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const userStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]) });

export const clinicCreateSchema = z.object({
  profile: clinicProfileSchema,
  slug: label,
  branding: brandingSchema,
  admin: z.object({ name: requiredText("Name", { max: 120 }), email, phone: optionalPhone, role: z.enum(["CLINIC_ADMIN", "DOCTOR"], { error: "Choose a role." }) }),
  status: z.enum(["PENDING", "TRIAL", "ACTIVE", "SUSPENDED", "INACTIVE"]).default("TRIAL"),
});
export type ClinicCreateInput = z.infer<typeof clinicCreateSchema>;

export const inviteAcceptSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: z.string().min(10, "Password must be at least 10 characters.").max(128).refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Password must include at least one letter and one number."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match." });

export { roleKey, phone };
