export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "General Consultation!" -> "general-consultation". Unicode-safe: non-latin input falls back to the given base. */
export function slugify(input: string, fallback = "item"): string {
  const s = input
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/g, "");
  return s || fallback;
}

/** First free slug among `taken`: base, base-2, base-3 … */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, 66)}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 50)}-${Date.now().toString(36)}`;
}

/** Reserved first path segments that a slug may never collide with when used at the top level. */
export const RESERVED_SLUGS = ["new", "edit", "page", "feed", "rss"];
