import { z } from "zod";
import { idSchema, paginationSchema } from "@/lib/validations";

/** Request shapes of the public API (/api/v1). Deliberately narrower than the dashboard's: no suppression, owner or source fields. */

const customFields = z.record(z.string().max(40), z.string().max(500)).refine((o) => Object.keys(o).length <= 30, "At most 30 custom fields");

export const apiContactCreateSchema = z.object({
  phone: z.string().trim().min(6, "phone is required").max(25),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(255).or(z.literal("")).optional(),
  lifecycle: z.enum(["lead", "customer"]).optional(),
  lead_status: z.enum(["new", "contacted", "qualified", "proposal", "won", "lost"]).optional(),
  custom_fields: customFields.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  /** Consent may only be recorded together with evidence of where it was given. */
  opt_in: z.object({ evidence: z.string().trim().min(3, "Say where consent was given").max(500) }).optional(),
});
export const apiContactUpdateSchema = apiContactCreateSchema.omit({ phone: true, opt_in: true }).extend({ phone: z.string().trim().min(6).max(25).optional() });

export const apiContactListSchema = paginationSchema.extend({ q: z.string().trim().max(100).optional().default(""), phone: z.string().trim().max(25).optional().default("") });
export const apiListSchema = paginationSchema.extend({ number_id: z.string().max(64).optional().default("") });
export const apiMessagesListSchema = paginationSchema;

export const apiSendSchema = z
  .object({
    number_id: idSchema.optional(),
    to: z.string().trim().min(6, "to is required").max(25),
    type: z.enum(["text", "template"]),
    text: z.string().trim().min(1).max(4096).optional(),
    template: z.object({ name: z.string().trim().min(1).max(512), language: z.string().trim().min(2).max(10), values: z.record(z.string().max(40), z.string().max(1024)).optional().default({}) }).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "text" && !v.text) ctx.addIssue({ code: "custom", path: ["text"], message: "text is required for type “text”" });
    if (v.type === "template" && !v.template) ctx.addIssue({ code: "custom", path: ["template"], message: "template is required for type “template”" });
  });
