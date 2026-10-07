/** Only these URL shapes may ever be rendered as links/images from CMS content. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  if (u.startsWith("/") && !u.startsWith("//") && !u.includes("\\")) return u;
  try {
    const parsed = new URL(u);
    return ["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export const isExternal = (href: string) => /^https?:\/\//i.test(href);

/** Site images are stored by us and addressed only as /api/assets/<id>[?v=timestamp]. */
export const SITE_IMAGE_RE = /^\/api\/assets\/[a-z0-9]{10,40}(\?v=\d+)?$/;
export const siteImageId = (url: string) => /^\/api\/assets\/([a-z0-9]{10,40})/.exec(url)?.[1] ?? null;

/** https://wa.me/<digits> — only built from a number the clinic configured. */
export const whatsappUrl = (digits: string | null | undefined, text?: string) =>
  digits ? `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}` : null;

export function mapsLink(parts: (string | null | undefined)[]) {
  const q = parts.filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}
