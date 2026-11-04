/**
 * Small, safe Markdown → HTML for blog posts. All text is HTML-escaped first; only the tags produced here
 * are emitted. Supports: ## / ### headings (with ids), paragraphs, - and 1. lists, > quotes, **bold**,
 * _italic_, `code`, [links](https://… or /path) and --- rules. No raw HTML, no images, no scripts.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

function inline(text: string): string {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, href: string) => {
    const raw = href.replace(/&amp;/g, "&");
    const ok = /^https:\/\/[^\s]+$/i.test(raw) || /^\/[^\s/][^\s]*$|^\/$/.test(raw) || /^#[\w-]+$/.test(raw);
    if (!ok) return label;
    const external = /^https:/i.test(raw) && !/^https:\/\/(www\.)?mecgura\.tech/i.test(raw);
    return `<a href="${esc(raw)}"${external ? ' rel="noopener nofollow" target="_blank"' : ""}>${label}</a>`;
  });
  return s;
}

export type Heading = { id: string; text: string; level: 2 | 3 };

export function renderMarkdown(md: string): { html: string; headings: Heading[] } {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const headings: Heading[] = [];
  const used = new Set<string>();
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) {
      flushAll();
      const level = h[1].length as 2 | 3;
      const text = h[2].trim();
      let id = slugify(text) || "section";
      for (let i = 2; used.has(id); i++) id = `${slugify(text)}-${i}`;
      used.add(id);
      headings.push({ id, text, level });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flushAll();
      out.push("<hr />");
      continue;
    }
    const ul = /^\s*[-*]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const type = ul ? "ul" : "ol";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }
    if (!line.trim()) {
      flushAll();
      continue;
    }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return { html: out.join("\n"), headings };
}

/** Plain text (for reading time and descriptions). */
export const plainText = (md: string) => md.replace(/[#>*_`[\]()-]/g, " ").replace(/\s+/g, " ").trim();
export const readingMinutes = (md: string) => Math.max(1, Math.round(plainText(md).split(" ").length / 200));
