import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { IMPORT_KINDS, isImportKind, mapHeaders, type ImportKind } from "@/lib/import/kinds";
import { ImportFileError, parseUpload } from "@/lib/import/table";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import type { Client } from "./clinic-shared";
import { createMedicine, saveSupplier } from "./pharmacy-master";
import { saveInvestigation } from "./lab-master";
import { registerPatient } from "./patient-crm";

export type RowStatus = "ok" | "duplicate" | "error" | "created";
export interface ImportRowResult { row: number; status: RowStatus; messages: string[]; summary: string }
export interface ImportReport {
  kind: string; mode: "preview" | "commit"; total: number; ok: number; duplicates: number; errors: number; created: number;
  truncated: boolean; unknownColumns: string[]; rows: ImportRowResult[]; problemsCsv: string;
}
const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const SHOWN = 300;
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);
const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Existing records, loaded once, so duplicates are found without one query per row. */
async function existing(ctx: TenantRequestContext, kind: ImportKind): Promise<Set<string>> {
  const tdb = db(ctx);
  if (kind.key === "medicines") return new Set((await tdb.medicine.findMany({ select: { genericName: true, brandName: true, strength: true } }) as { genericName: string; brandName: string | null; strength: string | null }[]).map((m) => [m.genericName, m.brandName, m.strength].map(lower).join("|")));
  if (kind.key === "suppliers") return new Set((await tdb.supplier.findMany({ select: { supplierName: true } }) as { supplierName: string }[]).map((s) => lower(s.supplierName)));
  if (kind.key === "lab-tests") return new Set((await tdb.investigation.findMany({ select: { testCode: true } }) as { testCode: string }[]).map((t) => t.testCode.toUpperCase()));
  const ps = await tdb.patient.findMany({ select: { phone: true, name: true, dateOfBirth: true }, take: 100_000 }) as { phone: string | null; name: string; dateOfBirth: Date | string | null }[];
  const set = new Set<string>();
  for (const p of ps) { if (p.phone) set.add(`p:${digits(p.phone)}`); if (p.dateOfBirth) set.add(`n:${lower(p.name)}|${p.dateOfBirth instanceof Date ? p.dateOfBirth.toISOString().slice(0, 10) : p.dateOfBirth}`); }
  return set;
}
const patientKeys = (i: Record<string, unknown>) => [`p:${digits(i.phone)}`, ...(i.dateOfBirth ? [`n:${lower(i.name)}|${i.dateOfBirth}`] : [])];

async function createOne(ctx: TenantRequestContext, kind: ImportKind, input: Record<string, unknown>) {
  if (kind.key === "medicines") return createMedicine(ctx, input);
  if (kind.key === "suppliers") return saveSupplier(ctx, null, input);
  if (kind.key === "lab-tests") return saveInvestigation(ctx, null, input);
  return registerPatient(ctx, { ...input, allowDuplicate: false, privacyAcknowledged: false });
}
const summarise = (kind: ImportKind, i: Record<string, unknown>) => kind.key === "patients" ? `${i.name ?? ""} · ${i.phone ?? ""}` : kind.key === "medicines" ? [i.brandName ?? i.genericName, i.strength].filter(Boolean).join(" ") : kind.key === "suppliers" ? String(i.supplierName ?? "") : `${i.testCode ?? ""} ${i.testName ?? ""}`.trim();
const csvCell = (v: string) => { const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export async function runImport(ctx: TenantRequestContext, kindKey: string, file: { name: string; bytes: Uint8Array }, mode: "preview" | "commit"): Promise<ImportReport> {
  if (!isImportKind(kindKey)) throw new AppError("NOT_FOUND", { message: "Unknown import type." });
  const kind = IMPORT_KINDS[kindKey];
  if (!kind.allowed(ctx)) throw new AppError("FORBIDDEN");
  const lim = await rateLimit(`import:${mode}:${ctx.user.id}`, { limit: mode === "commit" ? 20 : 60, windowMs: 60 * 60_000 });
  if (!lim.allowed) throw new AppError("RATE_LIMITED", { message: "Too many imports. Try again in a while." });

  let table; try { table = parseUpload(file.name, file.bytes); } catch (e) { if (e instanceof ImportFileError) throw new AppError("VALIDATION_ERROR", { message: e.message }); throw e; }
  const map = mapHeaders(kind, table.headers);
  if (map.missing.length) throw new AppError("VALIDATION_ERROR", { message: `The file is missing the column: ${map.missing.join(", ")}. Download the template to see the expected columns.` });

  const known = await existing(ctx, kind);
  const seen = new Set<string>();
  const rows: ImportRowResult[] = []; const problems: string[] = [];
  let ok = 0, duplicates = 0, errors = 0, created = 0;
  const add = (r: ImportRowResult, original: string[]) => { if (r.status !== "ok" && r.status !== "created") problems.push([...original.map(csvCell), csvCell(r.messages.join("; "))].join(",")); rows.push(r); };

  for (let n = 0; n < table.rows.length; n++) {
    const cells = table.rows[n]; const rowNo = n + 2; // spreadsheet row number (header is row 1)
    const values: Record<string, string> = {}; for (const [k, i] of Object.entries(map.index)) values[k] = cells[i] ?? "";
    const input = kind.build(values);
    const parsed = kind.schema.safeParse(input);
    if (!parsed.success) {
      errors++; add({ row: rowNo, status: "error", messages: [...new Set(parsed.error.issues.map((x) => (x.path.length ? `${String(x.path[0])}: ` : "") + x.message))], summary: summarise(kind, input) }, cells); continue;
    }
    const keys = kind.key === "patients" ? patientKeys(input) : [kind.dupeKey?.(input) ?? ""].filter(Boolean);
    if (keys.some((k) => known.has(k) || seen.has(k))) { duplicates++; add({ row: rowNo, status: "duplicate", messages: [keys.some((k) => seen.has(k)) ? "Repeated in this file" : "Already exists, skipped"], summary: summarise(kind, input) }, cells); continue; }
    keys.forEach((k) => seen.add(k));
    if (mode === "preview") { ok++; add({ row: rowNo, status: "ok", messages: [], summary: summarise(kind, input) }, cells); continue; }
    try { await createOne(ctx, kind, input); created++; ok++; add({ row: rowNo, status: "created", messages: [], summary: summarise(kind, input) }, cells); }
    catch (e) {
      const conflict = e instanceof AppError && e.code === "CONFLICT";
      if (conflict) { duplicates++; add({ row: rowNo, status: "duplicate", messages: ["Already exists, skipped"], summary: summarise(kind, input) }, cells); }
      else { errors++; add({ row: rowNo, status: "error", messages: [e instanceof AppError ? e.message : "Could not be saved"], summary: summarise(kind, input) }, cells); if (e instanceof AppError && (e.code === "FORBIDDEN" || e.code === "RATE_LIMITED")) throw e; }
    }
  }
  if (mode === "commit") await recordAudit({ action: AUDIT_ACTIONS.DATA_IMPORTED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "import", metadata: { kind: kind.key, rows: table.rows.length, created, duplicates, errors } });
  const problemsCsv = problems.length ? "﻿" + [[...table.headers.map(csvCell), "Problem"].join(","), ...problems].join("\r\n") + "\r\n" : "";
  const interesting = [...rows.filter((r) => r.status === "error" || r.status === "duplicate"), ...rows.filter((r) => r.status === "ok" || r.status === "created")];
  return { kind: kind.key, mode, total: table.rows.length, ok, duplicates, errors, created, truncated: table.truncated, unknownColumns: map.unknown, rows: interesting.slice(0, SHOWN), problemsCsv };
}

/** Header + one example row, so people see exactly what to fill in. */
export function importTemplate(ctx: TenantRequestContext, kindKey: string) {
  if (!isImportKind(kindKey)) throw new AppError("NOT_FOUND", { message: "Unknown import type." });
  const kind = IMPORT_KINDS[kindKey]; if (!kind.allowed(ctx)) throw new AppError("FORBIDDEN");
  return { kind, columns: kind.fields.map((f) => ({ key: f.key, label: f.required ? `${f.label} *` : f.label })), example: Object.fromEntries(kind.fields.map((f) => [f.key, f.example])) };
}
