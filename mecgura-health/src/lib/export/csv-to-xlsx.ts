import { toXlsx, type Column, type ReportMeta, type Row } from "@/lib/analytics/export";
import { parseCsv } from "@/lib/import/table";

/**
 * Turns an already-built report CSV (header row first) into a real .xlsx so every report can be downloaded as Excel. Columns whose cells are all plain
 * numbers become number cells (so Excel can sum them); ids, phone numbers, batch numbers and anything with a leading zero stay text.
 */
const TEXTY = /phone|mobile|code|number|invoice|\bid\b|barcode|batch|pin|gst|return|receipt|ref/i;
export function csvToXlsx(csv: string, name: string): Uint8Array {
  const table = parseCsv(csv).filter((r) => r.some((c) => c !== ""));
  const head = table[0] ?? []; const body = table.slice(1);
  const cols: Column[] = head.map((label, i) => {
    const vals = body.map((r) => r[i] ?? "").filter((v) => v !== "");
    const numeric = vals.length > 0 && !TEXTY.test(label) && vals.every((v) => /^-?\d{1,15}(\.\d+)?$/.test(v) && !/^-?0\d/.test(v));
    return { key: `c${i}`, label, type: numeric ? "number" : "text" };
  });
  const rows: Row[] = body.map((r) => Object.fromEntries(cols.map((c, i) => [c.key, (r[i] ?? "").replace(/^'(?=[=+\-@\t\r])/, "")])));
  const meta: ReportMeta = { name, description: name, dataSource: "", range: "", timezone: "UTC", generatedAt: new Date().toISOString(), generatedBy: "", filters: "" };
  return toXlsx(meta, cols, rows);
}
