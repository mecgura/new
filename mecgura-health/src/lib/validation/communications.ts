import { z } from "zod";
import { CHANNELS, EVENT_TYPES, LANGUAGES, REMINDER_CHOICES } from "@/lib/communications/catalog";
import { DATE_RE } from "@/lib/scheduling/time";

const channel = z.enum(CHANNELS, { error: "Choose WhatsApp, SMS or Email." });
const event = z.enum(EVENT_TYPES as [string, ...string[]], { error: "Unknown notification." });
const language = z.enum(LANGUAGES, { error: "Choose English, Hindi or Punjabi." });
const min = z.preprocess((v) => (typeof v === "string" && v !== "" ? Number(v) : v), z.number().int().min(0).max(1439));

export const commSettingsSchema = z.object({
  whatsappEnabled: z.boolean(), smsEnabled: z.boolean(), emailEnabled: z.boolean(),
  channelOrder: z.array(channel).min(1).max(3).refine((a) => new Set(a).size === a.length, "Each channel can appear once."),
  senderName: z.string().trim().max(80).nullish().transform((v) => v || null),
  replyTo: z.string().trim().max(120).email("Enter a valid reply-to email.").nullish().or(z.literal("")).transform((v) => v || null),
  defaultLanguage: language,
  eventToggles: z.partialRecord(event, z.boolean()),
  reminderOffsets: z.array(z.number().refine((n) => (REMINDER_CHOICES as readonly number[]).includes(n), "Choose one of the listed reminder times.")).max(4, "At most 4 reminders.").refine((a) => new Set(a).size === a.length, "Each reminder time can appear once."),
  quietEnabled: z.boolean(), quietStartMin: min, quietEndMin: min,
  fallbackRules: z.partialRecord(channel, channel),
  maxRetries: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(0).max(6)),
  dailyCapPerPatient: z.preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(1).max(50)),
}).superRefine((v, c) => {
  for (const [from, to] of Object.entries(v.fallbackRules)) if (from === to) c.addIssue({ code: "custom", path: ["fallbackRules"], message: "A fallback must be a different channel." });
  if (v.quietEnabled && v.quietStartMin === v.quietEndMin) c.addIssue({ code: "custom", path: ["quietEndMin"], message: "Quiet hours must start and end at different times." });
});

export const templateSchema = z.object({
  channel, eventType: event, language, name: z.string().trim().min(2, "Give the template a name.").max(80),
  subject: z.string().max(200).nullish().transform((v) => (v && v.trim() ? v : null)),
  body: z.string({ error: "Write the message text." }).max(6000),
  providerTemplateId: z.string().trim().max(512).nullish().transform((v) => v || null),
  variables: z.array(z.string().max(40)).max(20).optional(),
  isDefault: z.boolean().optional(),
});
export const templateStatusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED", "DRAFT"], { error: "Unknown status." }) });
export const previewSchema = z.object({ channel, eventType: event.optional(), subject: z.string().max(200).nullish(), body: z.string().max(6000), language: language.optional() });

export const messageQuerySchema = z.object({
  channel: channel.optional().or(z.literal("").transform(() => undefined)), status: z.string().max(20).optional().or(z.literal("").transform(() => undefined)),
  event: event.optional().or(z.literal("").transform(() => undefined)), provider: z.string().max(30).optional().or(z.literal("").transform(() => undefined)), q: z.string().trim().max(60).optional(),
  from: z.string().regex(DATE_RE).optional().or(z.literal("").transform(() => undefined)), to: z.string().regex(DATE_RE).optional().or(z.literal("").transform(() => undefined)), page: z.coerce.number().int().min(1).max(10_000).optional(), patientId: z.string().max(40).optional(),
});
