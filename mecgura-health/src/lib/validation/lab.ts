import { z } from "zod";
import { CONFIG_KINDS, FLAGS, PRIORITIES, RESULT_TYPES } from "@/lib/lab/core";
import { requiredText } from "./fields";

const txt = (label: string, max: number) => z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).optional().transform((v) => (v ? v : undefined));
const n = (label: string) => z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number({ error: `${label} must be a number.` }).optional());

export const rangeSchema = z.object({
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().or(z.literal("").transform(() => undefined)).or(z.null().transform(() => undefined)),
  minAgeYears: n("Minimum age"), maxAgeYears: n("Maximum age"), low: n("Low"), high: n("High"), criticalLow: n("Critical low"), criticalHigh: n("Critical high"), text: txt("Range text", 120),
}).superRefine((r, ctx) => {
  if (r.low != null && r.high != null && r.low > r.high) ctx.addIssue({ code: "custom", path: ["high"], message: "High must not be below low." });
  if (r.minAgeYears != null && r.maxAgeYears != null && r.minAgeYears > r.maxAgeYears) ctx.addIssue({ code: "custom", path: ["maxAgeYears"], message: "Maximum age must not be below the minimum." });
});
export const parameterSchema = z.object({
  name: requiredText("Parameter name", { max: 80, min: 1 }), resultType: z.enum(RESULT_TYPES).default("NUMERIC"), unit: txt("Unit", 30),
  options: z.array(z.object({ value: requiredText("Option", { max: 60, min: 1 }), flag: z.enum(FLAGS).optional().or(z.literal("").transform(() => undefined)) })).max(20).optional(),
  ranges: z.array(rangeSchema).max(12).optional(),
});
export const investigationSchema = z.object({
  testCode: z.string().trim().min(1, "Enter a test code.").max(20).regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores.").transform((v) => v.toUpperCase()),
  testName: requiredText("Test name", { max: 120, min: 2 }), shortName: txt("Short name", 30), category: requiredText("Category", { max: 60, min: 1 }),
  description: txt("Description", 500), sampleType: txt("Sample type", 60), department: txt("Department", 60), preparation: txt("Preparation instructions", 500),
  turnaroundHours: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).max(2000).optional()),
  active: z.boolean().default(true),
  parameters: z.array(parameterSchema).max(40).default([]),
});
export type InvestigationInput = z.infer<typeof investigationSchema>;

export const configItemSchema = z.object({ kind: z.enum(CONFIG_KINDS, { error: "Choose a list." }), name: requiredText("Name", { max: 60, min: 1 }) });
export const partnerSchema = z.object({ name: requiredText("Partner name", { max: 100, min: 2 }), code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9._-]+$/).transform((v) => v.toUpperCase()), contact: txt("Contact", 200), address: txt("Address", 300), configRef: txt("Secret reference", 60) });

export const labOrderCreateSchema = z.object({
  investigationIds: z.array(z.string().min(1)).min(1, "Choose at least one test.").max(30, "At most 30 tests per order."),
  priority: z.enum(PRIORITIES, { error: "Choose a priority." }), clinicalNotes: txt("Clinical notes", 1000),
  source: z.enum(["INTERNAL", "EXTERNAL"]).default("INTERNAL"), labPartnerId: txt("Lab partner", 40),
}).superRefine((v, ctx) => { if (v.source === "EXTERNAL" && !v.labPartnerId) ctx.addIssue({ code: "custom", path: ["labPartnerId"], message: "Choose the external laboratory." }); });

export const labActionSchema = z.object({
  action: z.enum(["confirm", "cancel", "collect", "receive", "reject", "startProcessing", "generateReport", "verify", "release", "requestCorrection", "amend", "setExternalRef"], { error: "Unknown action." }),
  sampleType: txt("Sample type", 60), sampleId: txt("Sample", 40), itemIds: z.array(z.string()).max(40).optional(),
  reason: txt("Reason", 300), notes: txt("Notes", 300), department: txt("Department", 60), externalRef: txt("External reference", 60),
});

export const resultEntriesSchema = z.object({
  entries: z.array(z.object({ position: z.number().int().min(0).max(60), value: z.string().trim().max(500), remarks: txt("Remarks", 300) })).max(60),
  submit: z.boolean().default(false), reason: txt("Reason", 300),
});
export const reviewSchema = z.object({ status: z.enum(["ACKNOWLEDGED", "REVIEWED"]), note: txt("Note", 1000) });
