// Press release and report files (DOCX and PDF). Server-side only; no fonts or files are read from disk.
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { ContentOf } from "@/lib/onepost";

export type PressRelease = ContentOf<"press_release">;

/** PDF files here use the standard Latin fonts. Text in other scripts (Hindi, Punjabi) is exported as DOCX instead. */
const LATIN = /^[\u0009\u000a\u000d -~ -ÿ–—‘’“”•…€™₹]*$/;
export const isLatinOnly = (s: string) => LATIN.test(s);
export class UnsupportedPdfText extends Error {}

const clean = (s: string) => s.replace(/→/g, "->").replace(/₹/g, "Rs. ").replace(/•/g, "-").replace(/…/g, "...").replace(/ /g, " ");

const paras = (text: string) => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

export async function pressReleaseDocx(pr: PressRelease, business: string): Promise<Uint8Array> {
  const contact = [pr.contactName, pr.contactEmail, pr.contactPhone].filter(Boolean).join(" · ");
  const doc = new Document({
    creator: business || "MECGURA",
    title: pr.headline,
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ text: "PRESS RELEASE", bold: true, size: 20, characterSpacing: 40, color: "666666" })], spacing: { after: 200 } }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: pr.headline, bold: true })], spacing: { after: 120 } }),
          ...(pr.subheadline ? [new Paragraph({ children: [new TextRun({ text: pr.subheadline, italics: true })], spacing: { after: 240 } })] : []),
          ...paras(pr.body).map((p, i) => new Paragraph({ children: [...(i === 0 ? [new TextRun({ text: `${pr.dateline} — `, bold: true })] : []), new TextRun({ text: p })], spacing: { after: 200 } })),
          ...(pr.quoteText ? [new Paragraph({ children: [new TextRun({ text: `“${pr.quoteText}”`, italics: true }), ...(pr.quoteBy ? [new TextRun({ text: ` — ${pr.quoteBy}` })] : [])], indent: { left: 480 }, spacing: { after: 200 } })] : []),
          ...(pr.boilerplate ? [new Paragraph({ children: [new TextRun({ text: "About ", bold: true }), new TextRun({ text: pr.boilerplate, size: 20 })], spacing: { before: 200, after: 200 } })] : []),
          ...(contact ? [new Paragraph({ children: [new TextRun({ text: "Media contact: ", bold: true }), new TextRun({ text: contact })], spacing: { after: 200 } })] : []),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "###" })] }),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

type Line = { text: string; font: PDFFont; size: number; gap?: number };

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  // Anything the standard font cannot draw becomes "?" instead of failing the whole file.
  text = clean(text).replace(/[^\u0009\u000a\u000d -~\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac\u2122]/g, "?");
  for (const raw of text.split("\n")) {
    let line = "";
    for (const word of raw.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/** A simple, clean A4 document: a list of text blocks flowed over as many pages as needed. */
async function flow(blocks: { text: string; style: "title" | "h2" | "body" | "small" | "label"; gap?: number }[], footer: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const W = 595.28;
  const H = 841.89;
  const M = 56;
  const style = { title: { font: bold, size: 20, color: rgb(0.08, 0.08, 0.08) }, h2: { font: bold, size: 13, color: rgb(0.1, 0.1, 0.1) }, body: { font: serif, size: 11.5, color: rgb(0.1, 0.1, 0.1) }, small: { font: regular, size: 9.5, color: rgb(0.35, 0.35, 0.35) }, label: { font: bold, size: 8.5, color: rgb(0.4, 0.4, 0.4) } } as const;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  for (const b of blocks) {
    const st = style[b.style];
    const lines: Line[] = wrap(clean(b.text), st.font, st.size, W - 2 * M).map((text) => ({ text, font: st.font, size: st.size }));
    const lh = st.size * 1.4;
    for (const l of lines) {
      if (y - lh < M + 20) newPage();
      if (l.text) page.drawText(l.text, { x: M, y: y - st.size, size: st.size, font: st.font, color: st.color });
      y -= lh;
    }
    y -= b.gap ?? 6;
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`${clean(footer)}  ·  Page ${i + 1} of ${pages.length}`, { x: M, y: 28, size: 8, font: regular, color: rgb(0.5, 0.5, 0.5) }));
  return pdf.save();
}

export async function pressReleasePdf(pr: PressRelease, business: string): Promise<Uint8Array> {
  const all = [pr.headline, pr.subheadline, pr.dateline, pr.body, pr.quoteText, pr.quoteBy, pr.boilerplate, pr.contactName, pr.contactEmail, pr.contactPhone, business].join("\n");
  if (!isLatinOnly(all)) throw new UnsupportedPdfText("PDF export supports English and Hinglish. For Hindi or Punjabi, download the Word (DOCX) file.");
  const contact = [pr.contactName, pr.contactEmail, pr.contactPhone].filter(Boolean).join("  ·  ");
  return flow(
    [
      { text: "PRESS RELEASE", style: "label", gap: 10 },
      { text: pr.headline, style: "title", gap: 6 },
      ...(pr.subheadline ? [{ text: pr.subheadline, style: "h2" as const, gap: 14 }] : []),
      ...paras(pr.body).map((p, i) => ({ text: i === 0 ? `${pr.dateline} - ${p}` : p, style: "body" as const, gap: 9 })),
      ...(pr.quoteText ? [{ text: `"${pr.quoteText}"${pr.quoteBy ? ` - ${pr.quoteBy}` : ""}`, style: "body" as const, gap: 12 }] : []),
      ...(pr.boilerplate ? [{ text: "About", style: "label" as const, gap: 2 }, { text: pr.boilerplate, style: "small" as const, gap: 12 }] : []),
      ...(contact ? [{ text: "Media contact", style: "label" as const, gap: 2 }, { text: contact, style: "small" as const, gap: 12 }] : []),
      { text: "###", style: "small", gap: 0 },
    ],
    business || "Press release",
  );
}

export type ReportData = {
  business: string;
  month: string;
  generatedAt: string;
  posts: { created: number; byStatus: Record<string, number> };
  published: { channel: string; label: string; count: number }[];
  failed: number;
  items: { title: string; channel: string; status: string; at: string; url: string }[];
  pr: { sent: number; opened: number; covered: number };
  search: { available: boolean; note: string; totals?: { clicks: number; impressions: number; ctr: number; position: number }; queries?: { key: string; clicks: number; impressions: number; position: number }[] };
};

const safe = (s: string) => (isLatinOnly(s) ? s : "[title in another script]");

export async function reportPdf(r: ReportData): Promise<Uint8Array> {
  const blocks: Parameters<typeof flow>[0] = [
    { text: "MONTHLY CONTENT REPORT", style: "label", gap: 8 },
    { text: `${safe(r.business)} - ${r.month}`, style: "title", gap: 14 },
    { text: "Summary", style: "h2", gap: 4 },
    { text: `Posts created: ${r.posts.created}\nPublished to channels: ${r.published.reduce((a, b) => a + b.count, 0)}\nFailed to publish: ${r.failed}\nPress pitches sent: ${r.pr.sent}   opened: ${r.pr.opened}   covered: ${r.pr.covered}`, style: "body", gap: 12 },
    { text: "Published by channel", style: "h2", gap: 4 },
    { text: r.published.length ? r.published.map((p) => `${p.label}: ${p.count}`).join("\n") : "Nothing was published this month.", style: "body", gap: 12 },
    { text: "Posts", style: "h2", gap: 4 },
    { text: r.items.length ? r.items.slice(0, 60).map((i) => `${i.at.slice(0, 10)}  ${i.channel}  ${i.status}  ${safe(i.title)}${i.url ? `\n${i.url}` : ""}`).join("\n\n") : "No posts went out this month.", style: "small", gap: 12 },
    { text: "Search performance (Google Search Console)", style: "h2", gap: 4 },
  ];
  if (r.search.available && r.search.totals) {
    const t = r.search.totals;
    blocks.push({ text: `Clicks: ${t.clicks}   Impressions: ${t.impressions}   Click rate: ${(t.ctr * 100).toFixed(1)}%   Average position: ${t.position.toFixed(1)}`, style: "body", gap: 6 });
    blocks.push({ text: (r.search.queries ?? []).slice(0, 15).map((q) => `${safe(q.key)}  -  ${q.clicks} clicks, ${q.impressions} impressions, position ${q.position.toFixed(1)}`).join("\n") || "No keywords yet.", style: "small", gap: 12 });
  } else blocks.push({ text: r.search.note, style: "small", gap: 12 });
  blocks.push({ text: "Reach (how many people saw each post) is not included: the channels' reach numbers are not collected yet.", style: "small", gap: 0 });
  return flow(blocks, `Generated ${r.generatedAt.slice(0, 10)} by MECGURA OnePost`);
}
