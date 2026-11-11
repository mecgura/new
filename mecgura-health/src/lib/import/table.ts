import { unzipSync, strFromU8 } from "fflate";

/**
 * Reads an uploaded spreadsheet into rows of text. Supports .csv (comma, semicolon or tab; UTF-8) and .xlsx (first sheet).
 * Defensive by design: hard caps on size, rows, columns and on what a zip is allowed to expand to (zip-bomb guard); formulas are
 * never evaluated (only their cached text value is read); nothing here touches the database.
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 1000;
export const MAX_COLS = 40;
const MAX_UNZIPPED = 25 * 1024 * 1024;

export interface ParsedTable { headers: string[]; rows: string[][]; truncated: boolean }
export class ImportFileError extends Error {}

/* ---------------------------------- CSV ---------------------------------- */
export function parseCsv(input: string): string[][] {
  let text = input.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<string, number>; let q = false;
  for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [","])[0] || ",";
  const rows: string[][] = []; let row: string[] = []; let cur = ""; q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; rows.push(row); row = []; if (rows.length > MAX_ROWS + 2) break; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  text = "";
  return rows;
}

/* ---------------------------------- XLSX ---------------------------------- */
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
/** Excel stores dates as day counts since 1899-12-30. */
const serialToIso = (n: number) => new Date(Math.round((n - 25569) * 86400) * 1000).toISOString().slice(0, 10);
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");

export function parseXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  let total = 0;
  try {
    files = unzipSync(bytes, { filter: (f) => { total += f.originalSize; if (total > MAX_UNZIPPED) throw new ImportFileError("This spreadsheet is too large once unpacked."); return /^(xl\/(sharedStrings|workbook|styles)\.xml|xl\/worksheets\/sheet\d+\.xml|xl\/_rels\/workbook\.xml\.rels)$/.test(f.name); } });
  } catch (e) { if (e instanceof ImportFileError) throw e; throw new ImportFileError("This file isn't a valid .xlsx workbook."); }
  const get = (n: string) => (files[n] ? strFromU8(files[n]) : "");
  const shared = [...get("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  // Which cell formats are dates (numFmt ids 14-22, 45-47 and custom formats containing d/m/y).
  const styles = get("xl/styles.xml");
  const customDate = new Set([...styles.matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)].filter((m) => /[dmy]/i.test(m[2].replace(/\[[^\]]*\]|"[^"]*"/g, ""))).map((m) => Number(m[1])));
  const xfs = [...(styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? "").matchAll(/<xf\s[^>]*?numFmtId="(\d+)"/g)].map((m) => Number(m[1]));
  const isDateFmt = (id: number) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || customDate.has(id);
  const sheetName = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0];
  if (!sheetName) throw new ImportFileError("This workbook has no sheets.");
  const rows: string[][] = [];
  for (const rm of get(sheetName).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]; const inner = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]; const idx = ref ? colIndex(ref) : row.length;
      if (idx >= MAX_COLS) continue;
      const t = /\bt="(\w+)"/.exec(attrs)?.[1]; const s = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? 0);
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = "";
      if (t === "s") val = shared[Number(v)] ?? "";
      else if (t === "inlineStr") val = textOf(inner);
      else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) { val = unxml(v); if ((t === undefined || t === "n") && /^-?\d+(\.\d+)?$/.test(val) && isDateFmt(xfs[s] ?? 0)) val = serialToIso(Number(val)); }
      while (row.length < idx) row.push(""); row[idx] = val;
    }
    rows.push(row); if (rows.length > MAX_ROWS + 2) break;
  }
  return rows;
}

/* ---------------------------------- entry ---------------------------------- */
export function parseUpload(name: string, bytes: Uint8Array): ParsedTable {
  if (bytes.length === 0) throw new ImportFileError("The file is empty.");
  if (bytes.length > MAX_FILE_BYTES) throw new ImportFileError(`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const lower = name.toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let all: string[][];
  if (lower.endsWith(".xlsx") && isZip) all = parseXlsx(bytes);
  else if (lower.endsWith(".csv") || lower.endsWith(".txt")) { if (isZip) throw new ImportFileError("This looks like an Excel file; rename it to .xlsx."); all = parseCsv(new TextDecoder("utf-8").decode(bytes)); }
  else if (lower.endsWith(".xls")) throw new ImportFileError("Old .xls files aren't supported. In Excel choose File → Save As → Excel Workbook (.xlsx) or CSV.");
  else throw new ImportFileError("Upload an Excel (.xlsx) or CSV file.");
  const cleaned = all.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
  if (cleaned.length < 2) throw new ImportFileError("The file needs a header row and at least one data row.");
  const headers = cleaned[0].slice(0, MAX_COLS);
  const body = cleaned.slice(1);
  return { headers, rows: body.slice(0, MAX_ROWS).map((r) => headers.map((_, i) => r[i] ?? "")), truncated: body.length > MAX_ROWS };
}

export const normHeader = (h: string) => h.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "");
