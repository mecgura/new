import { inflateRawSync } from "node:zlib";

/**
 * Turns uploaded files and web pages into plain text for the AI knowledge
 * base. Only text is kept; the original file is never stored.
 */

export class ExtractError extends Error {}

const MAX_ZIP_ENTRY = 20_000_000;

/** Reads one file out of a ZIP archive (DOCX is a ZIP) using the central directory. */
export function readZipEntry(buf: Buffer, name: string): Buffer | null {
  // End of central directory record: scan back from the end (comment ≤ 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ExtractError("This file isn't a valid Word document.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entryName = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;
    if (size > MAX_ZIP_ENTRY) throw new ExtractError("This document is too large to read.");
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new ExtractError("This file isn't a valid Word document.");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ZIP_ENTRY });
    throw new ExtractError("This Word document uses an unsupported compression.");
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", rupee: "₹", copy: "©", reg: "®", trade: "™" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const tidy = (s: string) =>
  s
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Word (.docx): paragraphs, line breaks, tabs and table cells become plain text. */
export function docxToText(buf: Buffer): string {
  const xml = readZipEntry(buf, "word/document.xml");
  if (!xml) throw new ExtractError("This file isn't a valid Word document (.docx).");
  const s = xml
    .toString("utf8")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeEntities(s));
}

/** PDF: text layer of every page. Scanned (image-only) PDFs have no text and are refused. */
export async function pdfToText(buf: Buffer): Promise<string> {
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ExtractError("This file isn't a valid PDF.");
  const { extractText, getDocumentProxy } = await import("unpdf");
  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const r = await extractText(pdf, { mergePages: false });
    text = (r.text as string[]).map((p) => p.trim()).filter(Boolean).join("\n\n");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    throw new ExtractError(/password/i.test(msg) ? "This PDF is password-protected. Remove the password and upload it again." : "This PDF couldn't be read.");
  }
  text = tidy(text);
  if (text.replace(/\s/g, "").length < 20) throw new ExtractError("This PDF has no readable text (it looks scanned). Paste the text instead.");
  return text;
}

/** Web page: drops scripts, styles, navigation chrome and markup; keeps headings, paragraphs and list items. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = tidy(decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, ""))).slice(0, 120);
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const s = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|section|article|header|main|h[1-6]|ul|ol|tr|table|blockquote)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "");
  return { title, text: tidy(decodeEntities(s)) };
}

export type ExtractedFile = { text: string; mimeType: string };

/** Picks the extractor from the file extension (and checks the bytes match). */
export async function extractFile(name: string, buf: Buffer): Promise<ExtractedFile> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return { text: await pdfToText(buf), mimeType: "application/pdf" };
  if (ext === "docx") return { text: docxToText(buf), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  if (ext === "doc") throw new ExtractError("Old .doc files aren't supported. Save it as .docx or PDF and upload again.");
  if (ext === "md") return { text: buf.toString("utf8"), mimeType: "text/markdown" };
  if (ext === "csv") return { text: buf.toString("utf8"), mimeType: "text/csv" };
  if (ext === "txt") return { text: buf.toString("utf8"), mimeType: "text/plain" };
  if (ext === "html" || ext === "htm") return { text: htmlToText(buf.toString("utf8")).text, mimeType: "text/html" };
  throw new ExtractError("Upload a PDF, Word (.docx), TXT, Markdown, CSV or HTML file.");
}
