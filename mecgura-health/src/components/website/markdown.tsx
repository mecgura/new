import { isExternal } from "@/lib/website/urls";
import { parseMarkdown, type Block, type Inline } from "@/lib/website/markdown";

function Inlines({ nodes }: { nodes: Inline[] }) {
  return nodes.map((n, i) => {
    if (n.t === "text") return n.v;
    if (n.t === "br") return <br key={i} />;
    if (n.t === "b") return <strong key={i}><Inlines nodes={n.c} /></strong>;
    if (n.t === "i") return <em key={i}><Inlines nodes={n.c} /></em>;
    return <a key={i} href={n.href} {...(isExternal(n.href) ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}><Inlines nodes={n.c} /></a>;
  });
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "h2": return <h2><Inlines nodes={b.c} /></h2>;
    case "h3": return <h3><Inlines nodes={b.c} /></h3>;
    case "quote": return <blockquote><Inlines nodes={b.c} /></blockquote>;
    case "ul": return <ul>{b.items.map((it, i) => <li key={i}><Inlines nodes={it} /></li>)}</ul>;
    case "ol": return <ol>{b.items.map((it, i) => <li key={i}><Inlines nodes={it} /></li>)}</ol>;
    default: return <p><Inlines nodes={b.c} /></p>;
  }
}

/** Renders CMS rich text. Output is React elements only — never dangerouslySetInnerHTML. */
export function Markdown({ text, className }: { text?: string | null; className?: string }) {
  const blocks = parseMarkdown(text);
  if (!blocks.length) return null;
  return <div className={`prose-site ${className ?? ""}`}>{blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>;
}
