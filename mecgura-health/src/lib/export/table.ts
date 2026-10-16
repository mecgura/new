import { toXlsx, type Column, type ReportMeta, type Row } from "@/lib/analytics/export";

/**
 * Plain list exports (patients, medicines, suppliers, lab tests): header row first, one record per row, so the same file can be
 * edited in Excel and imported again. Text starting with = + - @ is prefixed with ' so Excel never evaluates it as a formula.
 */
export type ExportFormat = "csv" | "xlsx";
export const EXPORT_FORMAT_LIST: ExportFormat[] = ["xlsx", "csv"];

const safe = (v: unknown) => { const s = String(v ?? ""); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
const cell = (v: unknown) => { const s = safe(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function tableToCsv(cols: Column[], rows: Row[]): string {
  const head = cols.map((c) => cell(c.label)).join(",");
  const body = rows.map((r) => cols.map((c) => cell(r[c.key])).join(","));
  return "﻿" + [head, ...body].join("\r\n") + "\r\n"; // BOM: Excel opens UTF-8 (Devanagari/Gurmukhi names) correctly
}

export function tableToFile(meta: ReportMeta, cols: Column[], rows: Row[], format: ExportFormat, baseName: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "xlsx") return { filename: `${baseName}-${stamp}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: toXlsx(meta, cols, rows) as Uint8Array | string };
  return { filename: `${baseName}-${stamp}.csv`, contentType: "text/csv; charset=utf-8", body: tableToCsv(cols, rows) as Uint8Array | string };
}
