import { markdownToText } from "./markdown";
import { PAGE_PATH, type SitePageKey } from "./paths";
import type { SiteData } from "./types";

/**
 * Which pages exist for a site. A page appears only when it is switched on AND has something real to show
 * (e.g. no "Services" page until at least one service is published). Nothing is faked to fill a page.
 */
export function availablePages(site: SiteData): Set<SitePageKey> {
  const { content: c } = site;
  const has: Record<SitePageKey, boolean> = {
    home: true,
    about: !!(c.about.body || c.about.education || c.about.philosophy || c.hero.intro || site.doctors.length === 1),
    services: site.services.length > 0,
    doctors: site.doctors.length > 0,
    clinic: !!(site.identity.address || c.clinic.description || site.identity.phone || DAYS_OPEN(site) || c.clinic.facilities.length),
    testimonials: site.testimonials.length > 0,
    faq: site.faqs.length > 0,
    articles: site.articleTotal > 0 || site.articles.length > 0,
    contact: true,
    privacy: !!c.legal.privacy,
    terms: !!c.legal.terms,
    // Phase 3 builds the real booking engine; until then the page only shows a setup state with contact options.
    appointments: true,
  };
  const on = new Set<SitePageKey>();
  for (const k of Object.keys(has) as SitePageKey[]) {
    const enabled = k === "home" || k === "appointments" ? true : (c.pages as Record<string, boolean>)[k];
    if (enabled && has[k]) on.add(k);
  }
  return on;
}
const DAYS_OPEN = (site: SiteData) => Object.values(site.content.clinic.hours).some((d) => d.open);

export interface NavEntry { key: string; label: string; path: string }

/** Header navigation: configured order/labels, hidden when switched off or the page doesn't exist. */
export function navigationFor(site: SiteData): NavEntry[] {
  const on = availablePages(site);
  return site.content.navigation.filter((n) => n.visible && on.has(n.key)).map((n) => ({ key: n.key, label: n.label, path: PAGE_PATH[n.key] }));
}

export const clinicDescription = (site: SiteData) => site.content.footer.description || markdownToText(site.content.clinic.description, 200) || "";
