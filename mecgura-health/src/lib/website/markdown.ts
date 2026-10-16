import { safeHref } from "./urls";

/**
 * Minimal, SAFE rich text. CMS text is Markdown-lite parsed into a small AST that React renders as elements —
 * raw HTML is never interpreted (tags typed by an editor are shown as text), so there is no HTML injection surface.
 * Supported: ## / ### headings, paragraphs, - bullet lists, 1. numbered lists, > quotes, **bold**, *italic*, [text](url).
 */
export type Inline = { t: "text"; v: string } | { t: "b"; c: Inline[] } | { t: "i"; c: Inline[] } | { t: "a"; href: string; c: Inline[] } | { t: "br" };
export type Block =
  | { t: "h2" | "h3"; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "quote"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] };

const TOKEN = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\(([^)\s]+)\)/;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  while (rest) {
    const m = TOKEN.exec(rest);
    if (!m) { out.push({ t: "text", v: rest }); break; }
    if (m.index > 0) out.push({ t: "text", v: rest.slice(0, m.index) });
    if (m[1] !== undefined) out.push({ t: "b", c: parseInline(m[1]) });
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ t: "i", c: parseInline((m[2] ?? m[3])!) });
    else {
      const href = safeHref(m[5]);
      // an unsafe URL (javascript:, data:, …) degrades to plain text — never a link
      out.push(href ? { t: "a", href, c: parseInline(m[4]) } : { t: "text", v: m[4] });
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const withBreaks = (lines: string[]): Inline[] =>
  lines.flatMap((l, i) => (i ? [{ t: "br" } as Inline, ...parseInline(l)] : parseInline(l)));

export function parseMarkdown(src: string | null | undefined): Block[] {
  if (!src) return [];
  const blocks: Block[] = [];
  for (const chunk of src.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    const first = lines[0];
    if (/^###\s+/.test(first)) { blocks.push({ t: "h3", c: parseInline(first.replace(/^###\s+/, "")) }); if (lines.length > 1) blocks.push({ t: "p", c: withBreaks(lines.slice(1)) }); }
    else if (/^##\s+/.test(first)) { blocks.push({ t: "h2", c: parseInline(first.replace(/^##\s+/, "")) }); if (lines.length > 1) blocks.push({ t: "p", c: withBreaks(lines.slice(1)) }); }
    else if (lines.every((l) => /^[-*]\s+/.test(l))) blocks.push({ t: "ul", items: lines.map((l) => parseInline(l.replace(/^[-*]\s+/, ""))) });
    else if (lines.every((l) => /^\d+[.)]\s+/.test(l))) blocks.push({ t: "ol", items: lines.map((l) => parseInline(l.replace(/^\d+[.)]\s+/, ""))) });
    else if (lines.every((l) => /^>\s?/.test(l))) blocks.push({ t: "quote", c: withBreaks(lines.map((l) => l.replace(/^>\s?/, ""))) });
    else blocks.push({ t: "p", c: withBreaks(lines) });
  }
  return blocks;
}

/** Plain-text version (for meta descriptions / excerpts). */
export function markdownToText(src: string | null | undefined, max = 160): string {
  const flat = (xs: Inline[]): string => xs.map((x) => (x.t === "text" ? x.v : x.t === "br" ? " " : flat(x.c))).join("");
  const text = parseMarkdown(src).map((b) => ("items" in b ? b.items.map(flat).join(" ") : flat(b.c))).join(" ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
