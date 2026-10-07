/** Public website routes (relative to the clinic's own domain). Everything else belongs to the staff app. */
export const SITE_PAGE_KEYS = ["home", "about", "services", "doctors", "clinic", "testimonials", "faq", "articles", "contact", "privacy", "terms", "appointments"] as const;
export type SitePageKey = (typeof SITE_PAGE_KEYS)[number];

export const PAGE_PATH: Record<SitePageKey, string> = {
  home: "/", about: "/about", services: "/services", doctors: "/doctors", clinic: "/clinic", testimonials: "/testimonials",
  faq: "/faq", articles: "/articles", contact: "/contact", privacy: "/privacy", terms: "/terms", appointments: "/book-appointment",
};

const SECTION_ROOTS = ["/about", "/services", "/doctors", "/clinic", "/testimonials", "/faq", "/articles", "/contact", "/privacy", "/terms", "/book-appointment"];

/** Explicit allow-list, so a tenant host can never expose an app route by accident. */
export function isPublicSitePath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/sitemap.xml" || pathname === "/robots.txt") return true;
  return SECTION_ROOTS.some((r) => pathname === r || pathname === `${r}/` || (["/services", "/doctors", "/articles"].includes(r) && pathname.startsWith(`${r}/`)));
}

export type SiteRoute =
  | { page: Exclude<SitePageKey, "home"> | "home"; slug?: undefined }
  | { page: "service" | "doctor" | "article"; slug: string };

/** Path segments -> route (null = 404). */
export function resolveSiteRoute(segments: string[] | undefined): SiteRoute | null {
  const s = (segments ?? []).filter(Boolean);
  if (s.length === 0) return { page: "home" };
  const [a, b] = s;
  if (s.length === 1) {
    const hit = SITE_PAGE_KEYS.find((k) => k !== "home" && PAGE_PATH[k] === `/${a}`);
    return hit ? { page: hit } : null;
  }
  if (s.length === 2 && /^[a-z0-9-]{1,80}$/.test(b)) {
    if (a === "services") return { page: "service", slug: b };
    if (a === "doctors") return { page: "doctor", slug: b };
    if (a === "articles") return { page: "article", slug: b };
  }
  return null;
}

export const withBase = (base: string, path: string) => (path === "/" ? base || "/" : `${base}${path}`);
