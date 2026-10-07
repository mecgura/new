import { z } from "zod";
import { SERVICE_KEYS } from "@/lib/catalog";
import { DEFAULT_AUTH_OPTIONS, HEADER_TYPES, TEMPLATE_CATEGORIES } from "@/lib/templates";










export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(128),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;





export const razorpayConfigSchema = z.object({
  keyId: z
    .string()
    .max(100)
    .regex(/^rzp_(test|live)_[A-Za-z0-9]+$/, "Key ID must look like rzp_test_... or rzp_live_...")
    .or(z.literal("")),
  mode: z.enum(["test", "live"]),
});

export type RazorpayConfigInput = z.infer<typeof razorpayConfigSchema>;

















export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// Phase 1 — accounts, tenancy, notifications
// ---------------------------------------------------------------------------

export const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

export const emailSchema = z.string().trim().toLowerCase().email("Please enter a valid email address").max(255);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const listQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional().default(""),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(200).regex(/^[A-Za-z0-9_-]+$/, "Invalid token"),
  password: passwordSchema,
});

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
});

export const accountPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(128),
  newPassword: passwordSchema,
});

export const activeOrganizationSchema = z.object({ organizationId: idSchema });

export const organizationUpdateSchema = z.object({
  name: z.string().trim().min(2, "Organization name must be at least 2 characters").max(120),
});

export const orgRoleSchema = z.enum(["CLIENT_OWNER", "MANAGER", "AGENT"]);

export const addMemberSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  role: orgRoleSchema,
  // Required only when the email doesn't belong to an existing account.
  password: passwordSchema.optional(),
});

export const updateMemberSchema = z.object({ role: orgRoleSchema });

export const adminUserUpdateSchema = z
  .object({
    status: z.enum(["active", "disabled"]).optional(),
    name: z.string().trim().min(2).max(100).optional(),
  })
  .refine((v) => v.status !== undefined || v.name !== undefined, "Nothing to update");

export const auditQuerySchema = paginationSchema.extend({
  action: z.string().max(60).regex(/^[a-z_.]*$/).optional().default(""),
});

// ---------------------------------------------------------------------------
// Phase 2 — client management
// ---------------------------------------------------------------------------

export const mobileSchema = z
  .string()
  .trim()
  .max(20)
  .regex(/^\+?[0-9][0-9\s-]{6,18}$/, "Enter a valid mobile number");

/** Normalises to E.164; a bare 10-digit number is treated as Indian (+91). */
export const e164Schema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .transform((v) => (/^[6-9]\d{9}$/.test(v) ? `+91${v}` : v))
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +919876543210"));

export const serviceKeySchema = z.enum(SERVICE_KEYS);

export const createClientSchema = z.object({
  name: z.string().trim().min(2, "Company name is required").max(120),
  ownerName: z.string().trim().min(2, "Owner name is required").max(100),
  ownerEmail: emailSchema,
  ownerPassword: passwordSchema,
  mobile: mobileSchema.optional().or(z.literal("")).default(""),
  planId: idSchema,
  status: z.enum(["active", "suspended"]).default("active"),
  services: z.array(serviceKeySchema).max(SERVICE_KEYS.length).default([]),
});

export const clientUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    contactEmail: emailSchema.optional().or(z.literal("")),
    contactPhone: mobileSchema.optional().or(z.literal("")),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

export const clientListQuerySchema = listQuerySchema.extend({
  status: z.enum(["", "active", "suspended"]).optional().default(""),
  planId: z.string().max(64).optional().default(""),
});

export const servicesUpdateSchema = z.object({
  services: z.partialRecord(serviceKeySchema, z.boolean()),
});

/** billingMode: "complimentary" = contracted by MECGURA, no automatic invoices; "invoiced" = billed every month. */
export const assignPlanSchema = z.object({ planId: idSchema, billingMode: z.enum(["complimentary", "invoiced"]).optional().default("complimentary") });

export const resetAccessSchema = z.object({
  userId: idSchema.optional(),
  password: passwordSchema.optional(),
});

export const deleteClientSchema = z.object({ confirmName: z.string().min(1, "Type the company name").max(120) });

export { planSchema, planUpdateSchema } from "@/lib/plans";

export const whatsappAccountSchema = z.object({
  displayName: z.string().trim().min(2, "Display name is required").max(80),
  phoneNumber: e164Schema,
});

export const whatsappAccountUpdateSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    // "connected"/"disconnected" are set only by the WhatsApp integration (later phase).
    status: z.enum(["pending", "disabled"]).optional(),
  })
  .refine((v) => v.displayName !== undefined || v.status !== undefined, "Nothing to update");

// ---------------------------------------------------------------------------
// Phase 3 — WhatsApp connection center
// ---------------------------------------------------------------------------

const metaId = (label: string) => z.string().trim().regex(/^\d{5,25}$/, `${label} must be the numeric ID from Meta`);

export const embeddedStartSchema = z.object({ method: z.enum(["embedded_signup", "coexistence"]) });

export const embeddedCompleteSchema = z.object({
  state: z.string().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/),
  code: z.string().min(10).max(2000),
  wabaId: metaId("WABA ID"),
  phoneNumberId: metaId("Phone Number ID"),
});

export const embeddedCancelSchema = z.object({
  state: z.string().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/),
  reason: z.string().max(300).optional().default(""),
});

export const manualConnectSchema = z.object({
  wabaId: metaId("WABA ID"),
  phoneNumberId: metaId("Phone Number ID"),
  accessToken: z
    .string()
    .trim()
    .min(50, "Access token looks too short")
    .max(1024, "Access token looks too long")
    .regex(/^[A-Za-z0-9_\-|.]+$/, "Access token contains invalid characters"),
  appSecret: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{32}$/i, "App secret is a 32-character hex value")
    .optional()
    .or(z.literal("")),
});

export const demoConnectSchema = z.object({
  businessName: z.string().trim().min(2, "Business name is required").max(80),
});

export const whatsappSettingsSchema = z.object({
  displayName: z.string().trim().min(2, "Display name is required").max(80),
});

// ---------------------------------------------------------------------------
// Phase 4 — inbox, contacts, team
// ---------------------------------------------------------------------------

const httpsUrl = z.string().trim().url().max(2000).refine((u) => u.startsWith("https://"), "Must be an https link");

export const conversationListSchema = paginationSchema.extend({
  tab: z.enum(["all", "unread", "assigned", "mine"]).default("all"),
  q: z.string().trim().max(100).optional().default(""),
  status: z.enum(["open", "closed", "all"]).default("open"),
  accountId: z.string().max(64).optional().default(""),
  tagId: z.string().max(64).optional().default(""),
});

export const messagesQuerySchema = z.object({
  before: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

const replyTo = { replyToId: idSchema.optional() };

function mediaMessage<T extends "image" | "video" | "audio" | "document">(type: T) {
  return z.object({ type: z.literal(type), link: httpsUrl, caption: z.string().trim().max(1024).optional(), filename: z.string().trim().max(240).optional(), ...replyTo });
}

export const sendMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), body: z.string().trim().min(1, "Type a message").max(4096), ...replyTo }),
  z.object({ type: z.literal("flow"), flowId: idSchema, body: z.string().trim().max(1024).optional(), ...replyTo }),
  z.object({
    type: z.literal("template"),
    templateId: idSchema,
    values: z.record(z.string().max(64), z.string().max(2000)).default({}),
    ...replyTo,
  }),
  z.object({
    type: z.literal("interactive"),
    body: z.string().trim().min(1).max(1024),
    buttons: z.array(z.object({ id: z.string().trim().min(1).max(256), title: z.string().trim().min(1).max(20, "Button titles are max 20 characters") })).min(1).max(3),
    ...replyTo,
  }),
  mediaMessage("image"),
  mediaMessage("video"),
  mediaMessage("audio"),
  mediaMessage("document"),
]);

export const noteSchema = z.object({ body: z.string().trim().min(1, "Write a note").max(4000) });

export const assignSchema = z.object({ toUserId: idSchema.nullable(), note: z.string().trim().max(500).optional().default("") });

export const conversationStatusSchema = z.object({ status: z.enum(["open", "closed"]) });

export const startConversationSchema = z.object({ contactId: idSchema, whatsappAccountId: idSchema });

export const demoInboundSchema = z.object({
  whatsappAccountId: idSchema,
  phone: z.string().trim().min(6).max(25),
  name: z.string().trim().max(80).optional().default(""),
  type: z.enum(["text", "image", "video", "audio", "document"]).default("text"),
  body: z.string().trim().max(4096).default(""),
});

export const demoStatusSchema = z.object({ messageId: idSchema, status: z.enum(["delivered", "read", "failed"]) });

export const contactListSchema = paginationSchema.extend({
  tab: z.enum(["all", "customers", "leads", "opted_in", "opted_out", "suppressed"]).default("all"),
  q: z.string().trim().max(100).optional().default(""),
  tagId: z.string().max(64).optional().default(""),
  leadStatus: z.enum(["", "new", "contacted", "qualified", "proposal", "won", "lost"]).optional().default(""),
  ownerUserId: z.string().max(64).optional().default(""),
});

const customFieldsSchema = z
  .record(z.string().trim().min(1).max(40).regex(/^[\w .-]+$/, "Field names: letters, numbers, space, . _ -"), z.string().max(500))
  .refine((o) => Object.keys(o).length <= 30, "Up to 30 custom fields");

const contactFields = {
  name: z.string().trim().max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(255).or(z.literal("")),
  lifecycle: z.enum(["lead", "customer"]),
  leadStatus: z.enum(["new", "contacted", "qualified", "proposal", "won", "lost"]),
  source: z.enum(["manual", "whatsapp", "import", "api"]),
  ownerUserId: idSchema.nullable(),
  customFields: customFieldsSchema,
  suppressed: z.boolean(),
  suppressionReason: z.string().trim().max(200),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  optInStatus: z.enum(["opted_in", "opted_out"]),
  consentEvidence: z.string().trim().max(500),
};

export const createContactSchema = z.object({ phone: z.string().trim().min(6, "Phone is required").max(25), ...contactFields }).partial({
  name: true, email: true, lifecycle: true, leadStatus: true, source: true, ownerUserId: true, customFields: true, suppressed: true, suppressionReason: true, tags: true, optInStatus: true, consentEvidence: true,
});

export const updateContactSchema = z.object({ phone: z.string().trim().min(6).max(25), ...contactFields }).partial();

export const contactTagsSchema = z.object({ tags: contactFields.tags });
export const contactNoteSchema = z.object({ body: z.string().trim().min(1, "Write a note").max(4000) });
export const consentSchema = z.object({ status: z.enum(["opted_in", "opted_out"]), evidence: z.string().trim().max(500).optional().default("") });

export const agentStatusSchema = z.object({ status: z.enum(["online", "away", "offline"]) });

// ---------------------------------------------------------------------------
// Phase 5 — templates, segments, campaigns
// ---------------------------------------------------------------------------

const buttonText = z.string().trim().max(40);
const templateButtonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("QUICK_REPLY"), text: buttonText }),
  z.object({ type: z.literal("URL"), text: buttonText, url: z.string().trim().max(2000), example: z.string().trim().max(2000).optional() }),
  z.object({ type: z.literal("PHONE_NUMBER"), text: buttonText, phone: z.string().trim().max(20) }),
]);

const templateFields = {
  name: z.string().trim().toLowerCase().min(1, "Name is required").max(512),
  language: z.string().trim().min(2).max(10),
  category: z.enum(TEMPLATE_CATEGORIES),
  headerType: z.enum(HEADER_TYPES).default("none"),
  headerText: z.string().max(200).default(""),
  body: z.string().max(2000).default(""),
  footer: z.string().max(200).default(""),
  buttons: z.array(templateButtonSchema).max(12).default([]),
  examples: z
    .object({ header: z.array(z.string().max(1024)).max(1).optional(), body: z.array(z.string().max(1024)).max(60).optional() })
    .default({}),
  authOptions: z
    .object({
      addSecurityRecommendation: z.boolean().default(true),
      codeExpirationMinutes: z.number().int().nullable().default(10),
      buttonText: z.string().trim().max(40).default("Copy code"),
    })
    .default(DEFAULT_AUTH_OPTIONS),
};

export const templateCreateSchema = z.object({ wabaId: idSchema, ...templateFields });
export const templateUpdateSchema = z.object(templateFields);
export const templateListSchema = z.object({
  status: z.enum(["", "draft", "pending", "approved", "rejected", "paused", "disabled"]).optional().default(""),
  category: z.enum(["", ...TEMPLATE_CATEGORIES]).optional().default(""),
  q: z.string().trim().max(100).optional().default(""),
  wabaId: z.string().max(64).optional().default(""),
});
export const templateDuplicateSchema = z.object({ name: templateFields.name });
export const templateReviewSchema = z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().trim().max(300).optional().default("") });
export const templateSyncSchema = z.object({ wabaId: idSchema });

export const AUDIENCE_CONSENT = ["opted_in", "unknown", "opted_out"] as const;
export const audienceFiltersSchema = z.object({
  tagIds: z.array(idSchema).max(50).default([]),
  tagMode: z.enum(["any", "all"]).default("any"),
  excludeTagIds: z.array(idSchema).max(50).default([]),
  leadStatuses: z.array(z.enum(["new", "contacted", "qualified", "proposal", "won", "lost"])).max(6).default([]),
  lifecycles: z.array(z.enum(["lead", "customer"])).max(2).default([]),
  consent: z.array(z.enum(AUDIENCE_CONSENT)).max(3).default([]),
  sources: z.array(z.enum(["manual", "whatsapp", "import", "api"])).max(4).default([]),
});
export type AudienceFilters = z.infer<typeof audienceFiltersSchema>;

export const audienceSchema = z.object({
  mode: z.enum(["all", "filters", "segment", "contacts"]).default("filters"),
  filters: audienceFiltersSchema.default(audienceFiltersSchema.parse({})),
  segmentId: idSchema.nullable().optional(),
  contactIds: z.array(idSchema).max(10_000).default([]),
});
export type Audience = z.infer<typeof audienceSchema>;

export const segmentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(300).optional().default(""),
  filters: audienceFiltersSchema,
});

export const VARIABLE_FIELDS = ["name", "first_name", "phone", "email", "custom"] as const;
export const variableMappingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("static"), value: z.string().max(2000) }),
  z.object({ source: z.literal("field"), field: z.enum(VARIABLE_FIELDS), key: z.string().trim().max(40).optional().default(""), fallback: z.string().max(1024).optional().default("") }),
]);
export type VariableMapping = z.infer<typeof variableMappingSchema>;

export const campaignCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional().default(""),
  whatsappAccountId: idSchema,
});

export const campaignUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.string().trim().max(500),
    whatsappAccountId: idSchema,
    templateId: idSchema.nullable(),
    audience: audienceSchema,
    variables: z.record(z.string().max(64), variableMappingSchema),
    scheduledAt: z.coerce.date().nullable(),
    step: z.number().int().min(1).max(7),
  })
  .partial();

export const campaignListSchema = z.object({
  status: z.enum(["", "draft", "scheduled", "sending", "paused", "completed", "cancelled", "failed"]).optional().default(""),
  q: z.string().trim().max(100).optional().default(""),
});

export const campaignLaunchSchema = z.object({
  confirmConsent: z.literal(true, { message: "Confirm that every recipient opted in to receive these messages." }),
});

export const campaignActionSchema = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

export const campaignDemoSchema = z.object({
  delivered: z.number().int().min(0).max(10_000).default(0),
  read: z.number().int().min(0).max(10_000).default(0),
  failed: z.number().int().min(0).max(10_000).default(0),
  replies: z.number().int().min(0).max(10_000).default(0),
  optOuts: z.number().int().min(0).max(10_000).default(0),
});

// ---------------------------------------------------------------------------
// Phase 6 — automations
// ---------------------------------------------------------------------------

const label = z.string().trim().max(60).optional();
const onError = z.enum(["stop", "continue"]).default("stop");
const short = (n: number) => z.string().max(n).default("");
const varMapping = z.discriminatedUnion("source", [
  z.object({ source: z.literal("static"), value: z.string().max(2000) }),
  z.object({ source: z.literal("field"), field: z.enum(["name", "first_name", "phone", "email", "custom"]), key: short(40), fallback: short(1024) }),
]);
const pos = z.object({ x: z.number().finite().min(-100_000).max(100_000), y: z.number().finite().min(-100_000).max(100_000) });
const nodeBase = { id: z.string().min(1).max(64).regex(/^[\w-]+$/), position: pos };

/** Every node's data is parsed into a known shape, so the engine never sees arbitrary JSON. */
export const flowNodeSchema = z.discriminatedUnion("type", [
  z.object({
    ...nodeBase,
    type: z.literal("trigger"),
    data: z.object({
      label,
      trigger: z.enum(["new_contact", "incoming_message", "keyword", "button_click", "template_reply", "flow_submission", "webhook", "schedule", "tag_added", "lead_status"]),
      keywords: z.array(z.string().trim().max(60)).max(30).default([]),
      match: z.enum(["exact", "contains", "starts_with"]).default("exact"),
      buttonText: short(40),
      templateId: short(64),
      tagName: short(40),
      leadStatus: z.enum(["", "new", "contacted", "qualified", "proposal", "won", "lost"]).default(""),
      sources: z.array(z.enum(["manual", "whatsapp", "import", "api"])).max(4).default(["whatsapp", "manual", "api"]),
      schedule: z
        .object({ frequency: z.enum(["daily", "weekly"]).default("daily"), time: z.string().max(5).default("10:00"), days: z.array(z.number().int().min(0).max(6)).max(7).default([]), tagName: short(40) })
        .default({ frequency: "daily", time: "10:00", days: [], tagName: "" }),
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal("message"),
    data: z.object({ label, text: short(4096), buttons: z.array(z.string().max(40)).max(5).default([]), waitForReply: z.boolean().default(false), replyTimeoutMinutes: z.number().int().min(0).max(100_000).default(1440), fallbackTemplateId: short(64), onError }),
  }),
  z.object({ ...nodeBase, type: z.literal("template"), data: z.object({ label, templateId: short(64), variables: z.record(z.string().max(64), varMapping).default({}), onError }) }),
  z.object({ ...nodeBase, type: z.literal("delay"), data: z.object({ label, amount: z.number().int().min(0).max(100_000).default(5), unit: z.enum(["minutes", "hours", "days"]).default("minutes") }) }),
  z.object({
    ...nodeBase,
    type: z.literal("condition"),
    data: z.object({
      label,
      match: z.enum(["all", "any"]).default("any"),
      rules: z
        .array(
          z.object({
            field: z.enum(["message", "contact_name", "contact_email", "contact_phone", "custom", "tag", "lead_status", "source", "consent", "date", "time"]),
            key: short(40),
            operator: z.enum(["contains", "equals", "not_equals", "starts_with", "ends_with", "is_empty", "is_not_empty", "has", "not_has", "before", "after", "on"]),
            value: short(500),
          })
        )
        .max(20)
        .default([]),
    }),
  }),
  z.object({ ...nodeBase, type: z.literal("tag"), data: z.object({ label, action: z.enum(["add", "remove"]).default("add"), tagName: short(40) }) }),
  z.object({ ...nodeBase, type: z.literal("assign"), data: z.object({ label, mode: z.enum(["user", "auto"]).default("auto"), userId: short(64) }) }),
  z.object({ ...nodeBase, type: z.literal("update_contact"), data: z.object({ label, field: z.enum(["name", "email", "leadStatus", "lifecycle", "custom"]), key: short(40), value: short(500) }) }),
  z.object({ ...nodeBase, type: z.literal("webhook"), data: z.object({ label, url: short(2000), onError: z.enum(["stop", "continue"]).default("continue") }) }),
  z.object({ ...nodeBase, type: z.literal("ai_response"), data: z.object({ label, instructions: short(4000), sendReply: z.boolean().default(true), saveToField: short(40), onError: z.enum(["stop", "continue"]).default("continue") }) }),
  z.object({ ...nodeBase, type: z.literal("end"), data: z.object({ label }) }),
]);

export const graphSchema = z.object({
  nodes: z.array(flowNodeSchema).max(100),
  edges: z
    .array(z.object({ id: z.string().min(1).max(200), source: z.string().min(1).max(64), target: z.string().min(1).max(64), sourceHandle: z.string().max(20).nullable().optional() }))
    .max(300),
});

export const automationCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional().default(""),
  whatsappAccountId: idSchema.nullable().optional(),
  start: z.enum(["blank", "demo_welcome"]).default("blank"),
});

export const automationUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500),
    whatsappAccountId: idSchema.nullable(),
    graph: graphSchema,
    settings: z.object({ reentry: z.enum(["always", "once"]).default("always") }),
  })
  .partial();

export const automationListSchema = z.object({ status: z.enum(["", "draft", "active", "inactive"]).optional().default(""), q: z.string().trim().max(100).optional().default("") });
export const automationPublishSchema = z.object({ note: z.string().trim().max(200).optional().default("") });
export const automationActionSchema = z.object({ action: z.enum(["activate", "deactivate"]) });
export const automationTestSchema = z.object({ contactId: idSchema, skipDelays: z.boolean().default(true) });
export const executionListSchema = z.object({
  status: z.enum(["", "queued", "running", "completed", "failed", "stopped"]).optional().default(""),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  tests: z.enum(["include", "exclude", "only"]).optional().default("include"),
});
export const executionActionSchema = z.object({ action: z.enum(["stop", "retry"]) });
export const automationHookSchema = z.object({
  phone: z.string().trim().min(6).max(25),
  name: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().toLowerCase().email().max(255).or(z.literal("")).optional().default(""),
  data: z.record(z.string().max(60), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).optional().default({}),
});

// ---------------------------------------------------------------------------
// Phase 7 — WhatsApp Flows & AI agent
// ---------------------------------------------------------------------------

const flowField = z.object({
  name: z.string().trim().max(40),
  type: z.enum(["text", "email", "phone", "number", "textarea", "date", "dropdown", "radio", "checkbox", "optin"]),
  label: z.string().max(60),
  required: z.boolean().default(true),
  options: z.array(z.string().max(60)).max(30).default([]),
});
export const flowDefinitionSchema = z.object({
  start: z.object({ cta: z.string().max(40), body: z.string().max(1024) }),
  screens: z.array(z.object({ title: z.string().max(60), intro: z.string().max(500).default(""), fields: z.array(flowField).max(15), buttonLabel: z.string().max(40) })).max(10),
  confirmation: z.object({ enabled: z.boolean(), title: z.string().max(60).default(""), body: z.string().max(500).default("") }),
  submit: z.object({ label: z.string().max(40), thankYou: z.string().max(1000).default("") }),
  crm: z.object({
    fieldMap: z.record(z.string().max(40), z.enum(["ignore", "name", "email", "custom"])).default({}),
    lifecycle: z.enum(["", "lead", "customer"]).default(""),
    leadStatus: z.enum(["", "new", "contacted", "qualified", "proposal", "won", "lost"]).default(""),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    consentField: z.string().max(40).default(""),
    appointment: z.object({ enabled: z.boolean(), serviceField: z.string().max(40).default(""), dateField: z.string().max(40).default(""), timeField: z.string().max(40).default("") }),
    assign: z.enum(["none", "auto"]).default("none"),
    addNote: z.boolean().default(true),
  }),
});
export const flowCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  wabaId: idSchema,
  template: z.enum(["appointment", "lead", "product", "feedback", "order", "custom"]).default("custom"),
});
export const flowUpdateSchema = z.object({ name: z.string().trim().min(1).max(60), category: z.enum(["APPOINTMENT_BOOKING", "LEAD_GENERATION", "CONTACT_US", "CUSTOMER_SUPPORT", "SURVEY", "OTHER"]), definition: flowDefinitionSchema }).partial();
export const flowListSchema = z.object({ status: z.enum(["", "draft", "published", "deprecated"]).optional().default(""), q: z.string().trim().max(100).optional().default("") });
export const flowDemoSubmitSchema = z.object({
  phone: z.string().trim().min(6).max(25),
  name: z.string().trim().max(120).optional().default(""),
  answers: z.record(z.string().max(40), z.union([z.string().max(2000), z.array(z.string().max(60)).max(30), z.boolean()])),
});
export const submissionListSchema = z.object({ page: z.coerce.number().int().min(1).max(10_000).optional().default(1) });

const kbItem = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).default(""), price: z.string().trim().max(60).default("") });
export const aiAgentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  accountIds: z.array(idSchema).max(10).default([]),
  instructions: z.string().max(8000).default(""),
  knowledge: z
    .object({
      faqs: z.array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(2000) })).max(100).default([]),
      products: z.array(kbItem).max(100).default([]),
      services: z.array(kbItem).max(100).default([]),
      pricing: z.string().max(5000).default(""),
    })
    .default({ faqs: [], products: [], services: [], pricing: "" }),
  actions: z
    .object({
      answer: z.boolean().default(true),
      qualify: z.boolean().default(true),
      collect: z.boolean().default(true),
      collectFields: z.array(z.string().trim().min(1).max(40)).max(10).default(["name", "email", "city"]),
      book: z.boolean().default(false),
      bookingServices: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
      transfer: z.boolean().default(true),
      summarize: z.boolean().default(true),
    })
    .default({ answer: true, qualify: true, collect: true, collectFields: ["name", "email", "city"], book: false, bookingServices: [], transfer: true, summarize: true }),
  handoff: z
    .object({
      keywords: z.array(z.string().trim().min(1).max(40)).max(20).default(["agent", "human", "talk to someone", "call me"]),
      assign: z.enum(["auto", "user", "queue"]).default("auto"),
      userId: z.string().max(64).default(""),
      message: z.string().trim().max(500).default("Sure — I'm connecting you with our team. Someone will reply here shortly."),
      resume: z.enum(["manual", "on_close", "after_hours"]).default("manual"),
      resumeAfterHours: z.number().int().min(1).max(720).default(24),
    })
    .default({ keywords: ["agent", "human", "talk to someone", "call me"], assign: "auto", userId: "", message: "Sure — I'm connecting you with our team. Someone will reply here shortly.", resume: "manual", resumeAfterHours: 24 }),
});
export const aiAgentUpdateSchema = aiAgentSchema.partial();
export const aiStatusSchema = z.object({ status: z.enum(["active", "paused"]) });
export const aiTestSchema = z.object({
  history: z.array(z.object({ role: z.enum(["customer", "business"]), text: z.string().max(2000) })).max(30).default([]),
  message: z.string().trim().min(1, "Type a message").max(2000),
  mode: z.enum(["live", "demo"]).default("demo"),
});
export const aiConversationActionSchema = z.object({ action: z.enum(["pause", "resume", "summarize"]) });
export const appointmentUpdateSchema = z.object({ status: z.enum(["requested", "confirmed", "cancelled", "completed"]), startsAt: z.coerce.date().nullable().optional(), notes: z.string().max(1000).optional() });
