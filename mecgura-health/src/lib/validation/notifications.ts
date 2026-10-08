import { z } from "zod";
import { CATEGORIES, TYPE_KEYS, PRIORITIES, MAX_RULE_PRIORITY, PRIORITY_RANK } from "@/lib/notifications/catalog";
import { DATE_RE } from "@/lib/scheduling/time";

const emptyToUndef = (v: unknown) => (v === "" ? undefined : v);
export const notificationQuerySchema = z.object({
  filter: z.enum(["all", "unread", "archived", "expired", "ack"]).optional().catch(undefined),
  category: z.preprocess(emptyToUndef, z.string().regex(/^[A-Za-z]{2,12}$/).optional().catch(undefined)),
  priority: z.preprocess(emptyToUndef, z.enum(PRIORITIES).optional().catch(undefined)),
  range: z.preprocess(emptyToUndef, z.enum(["today", "yesterday", "7d", "30d", "custom"]).optional().catch(undefined)),
  from: z.preprocess(emptyToUndef, z.string().regex(DATE_RE).optional().catch(undefined)), to: z.preprocess(emptyToUndef, z.string().regex(DATE_RE).optional().catch(undefined)),
  q: z.preprocess(emptyToUndef, z.string().trim().max(60).optional()), page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined), pageSize: z.coerce.number().int().min(1).max(50).optional().catch(undefined),
});
export const prefsSchema = z.object({
  categories: z.partialRecord(z.enum(CATEGORIES), z.boolean()).optional(),
  quietEnabled: z.boolean().optional(), quietStartMin: z.number().int().min(0).max(1439).optional(), quietEndMin: z.number().int().min(0).max(1439).optional(), digestEnabled: z.boolean().optional(),
}).superRefine((v, c) => { if (v.quietEnabled && v.quietStartMin !== undefined && v.quietStartMin === v.quietEndMin) c.addIssue({ code: "custom", path: ["quietEndMin"], message: "Quiet hours must start and end at different times." }); });
const ROLE_TOKENS = ["CLINIC_ADMIN", "DOCTOR", "RECEPTIONIST", "COMPOUNDER", "NURSE", "LAB_STAFF", "ACCOUNTANT", "PHARMACY_STAFF", "PHARMACY_MANAGER", "STAFF", "@doctor", "@assignee", "@self"];
export const ruleSchema = z.object({
  type: z.enum(TYPE_KEYS as [string, ...string[]], { error: "Unknown notification." }),
  enabled: z.boolean(), inApp: z.boolean(),
  roles: z.array(z.enum(ROLE_TOKENS as [string, ...string[]])).max(12).optional(),
  priority: z.enum(PRIORITIES).nullish(), ackRequired: z.boolean().nullish(),
  escalateAfterMin: z.number().int().min(5, "At least 5 minutes.").max(1440, "At most 24 hours.").nullish(),
  externalChannels: z.array(z.enum(["WHATSAPP", "SMS", "EMAIL"])).nullish(),
}).superRefine((v, c) => {
  if (v.priority && PRIORITY_RANK[v.priority] > PRIORITY_RANK[MAX_RULE_PRIORITY]) c.addIssue({ code: "custom", path: ["priority"], message: "Critical is reserved for security and system incidents." });
});
export const settingsSchema = z.object({ retentionEnabled: z.boolean(), archiveReadAfterDays: z.number().int().min(7).max(730), expireAfterDays: z.number().int().min(30).max(3650), lowStockCheck: z.boolean() })
  .refine((v) => v.expireAfterDays > v.archiveReadAfterDays, { path: ["expireAfterDays"], message: "Must be longer than the archive time." });
