import { z } from "zod";

/** Plan-limit and retention FOUNDATION. These are stored configuration only: Phase 14 enforces no limit and deletes nothing. */
const lim = z.number().int().min(0).max(100_000_000).nullable();
export const limitsSchema = z.object({ maxDoctors: lim, maxStaff: lim, maxPatients: lim, maxAppointmentsPerMonth: lim, storageLimitMb: lim }).partial().strict();
export type Limits = z.infer<typeof limitsSchema>;
export const retentionSchema = z.object({ clinicalYears: z.number().int().min(1).max(100).nullable(), documentYears: z.number().int().min(1).max(100).nullable(), communicationDays: z.number().int().min(30).max(36500).nullable(), auditYears: z.number().int().min(1).max(100).nullable() }).partial().strict();
export type Retention = z.infer<typeof retentionSchema>;
export const LIMIT_LABELS: Record<keyof Required<Limits>, string> = { maxDoctors: "Max doctors", maxStaff: "Max staff", maxPatients: "Max patients", maxAppointmentsPerMonth: "Max appointments / month", storageLimitMb: "Storage limit (MB)" };
export const RETENTION_LABELS: Record<keyof Required<Retention>, string> = { clinicalYears: "Clinical data (years)", documentYears: "Documents (years)", communicationDays: "Communications (days)", auditYears: "Audit log (years)" };
export function parseJson<T>(schema: z.ZodType<T>, s: string | null | undefined, fallback: T): T { try { const r = schema.safeParse(s ? JSON.parse(s) : {}); return r.success ? r.data : fallback; } catch { return fallback; } }
