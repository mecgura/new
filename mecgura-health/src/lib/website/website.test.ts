import { describe, expect, it } from "vitest";
import { emptyContent, siteContentSchema, dayHoursSchema, describeDay } from "./content";
import { parseMarkdown, markdownToText } from "./markdown";
import { availablePages, navigationFor } from "./pages";
import { isPublicSitePath, resolveSiteRoute } from "./paths";
import { buildRobots, buildSitemap, jsonLdFor, jsonLdString, seoFor, toMetadata } from "./seo";
import { slugify, uniqueSlug } from "./slug";
import { safeHref, whatsappUrl, SITE_IMAGE_RE } from "./urls";
import type { SiteData } from "./types";
import { DEFAULT_BRAND } from "@/theme/tokens";
import { parseTenantHost } from "@/lib/tenant/host";
import { getTemplate, TEMPLATES } from "@/website/templates/registry";

const site = (over: Partial<SiteData> = {}): SiteData => ({
  mode: "public", template: "MODERN_MEDICAL",
  identity: { name: "Test Clinic", legalName: null, email: "a@b.test", phone: "+911234567890", address: "1 Road", city: "City", state: "State", pincode: "000", country: "India", isDemo: false },
  brand: DEFAULT_BRAND, logoUrl: null, faviconUrl: null, attribution: true, content: emptyContent(),
  services: [], doctors: [], testimonials: [], faqs: [], articles: [], articleTotal: 0, whatsappLink: null, updatedAt: new Date("2026-01-01"), ...over,
});
const svc = { slug: "s1", title: "S1", shortDescription: null, description: null, category: null, durationMinutes: null, fee: null, imageUrl: null, imageAlt: null, icon: null, seoTitle: null, seoDescription: null, isDraft: false };

describe("markdown (no HTML ever)", () => {
  const flat = (md: string) => JSON.stringify(parseMarkdown(md));
  it("keeps raw HTML as inert text", () => {
    const out = flat('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(out).toContain("<script>"); // present only as a text value
    expect(parseMarkdown("<b>x</b>")[0]).toMatchObject({ t: "p", c: [{ t: "text", v: "<b>x</b>" }] });
  });
  it("only http(s)/mailto/tel/relative links become links", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.com", "JaVaScRiPt:alert(1)"]) expect(flat(`[x](${bad})`)).not.toContain('"t":"a"');
    expect(flat("[x](https://ok.com)")).toContain('"t":"a"');
    expect(flat("[x](/services)")).toContain('"t":"a"');
    expect(safeHref("tel:+911234567890")).toBe("tel:+911234567890");
    expect(safeHref("javascript:alert(1)")).toBeNull();
  });
  it("parses headings, lists, bold, italics, quotes", () => {
    const b = parseMarkdown("## H\n\n- a\n- b\n\n1. x\n2. y\n\n> q\n\n**bold** and *it*");
    expect(b.map((x) => x.t)).toEqual(["h2", "ul", "ol", "quote", "p"]);
  });
  it("plain-text excerpt for meta descriptions", () => {
    expect(markdownToText("## Title\n\n**bold** text [link](https://x.com)", 100)).toBe("Title bold text link");
  });
});

describe("slugs", () => {
  it("slugifies safely", () => {
    expect(slugify("General Consultation!")).toBe("general-consultation");
    expect(slugify("  Café  &  Check-up ")).toBe("cafe-check-up");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("!!!", "item")).toBe("item");
  });
  it("makes unique slugs", () => {
    expect(uniqueSlug("a", new Set())).toBe("a");
    expect(uniqueSlug("a", new Set(["a", "a-2"]))).toBe("a-3");
  });
});

describe("site content schema", () => {
  it("defaults are empty — nothing invented", () => {
    const c = emptyContent();
    expect(c.hero.headline).toBe("");
    expect(Object.values(c.clinic.hours).every((d) => !d.open)).toBe(true);
    expect(c.navigation.map((n) => n.key)).toContain("contact");
  });
  it("validates hours, breaks, whatsapp, links and images", () => {
    expect(dayHoursSchema.safeParse({ open: true, from: "18:00", to: "09:00" }).success).toBe(false);
    expect(dayHoursSchema.safeParse({ open: true, from: "09:00", to: "17:00", breaks: [{ from: "13:00", to: "14:00" }] }).success).toBe(true);
    expect(dayHoursSchema.safeParse({ open: true, from: "09:00", to: "17:00", breaks: [{ from: "08:00", to: "10:00" }] }).success).toBe(false);
    expect(siteContentSchema.parse({ clinic: { whatsapp: "+91 98765 43210" } }).clinic.whatsapp).toBe("919876543210");
    expect(siteContentSchema.safeParse({ clinic: { whatsapp: "abc" } }).success).toBe(false);
    expect(siteContentSchema.safeParse({ clinic: { social: { facebook: "javascript:alert(1)" } } }).success).toBe(false);
    expect(siteContentSchema.safeParse({ clinic: { mapUrl: "http://insecure.com" } }).success).toBe(false);
    expect(siteContentSchema.safeParse({ hero: { imageUrl: "https://evil.com/x.png" } }).success).toBe(false);
    expect(siteContentSchema.safeParse({ hero: { imageUrl: "/api/assets/cmuxfredz001l0m7dt8vo8u7m?v=1" } }).success).toBe(true);
    expect(SITE_IMAGE_RE.test("/api/assets/../../etc/passwd")).toBe(false);
  });
  it("navigation: unique, known keys only (no arbitrary routes)", () => {
    expect(siteContentSchema.safeParse({ navigation: [{ key: "admin", label: "x", visible: true }] }).success).toBe(false);
    expect(siteContentSchema.safeParse({ navigation: [{ key: "home", label: "a", visible: true }, { key: "home", label: "b", visible: true }] }).success).toBe(false);
  });
  it("describes opening hours", () => {
    expect(describeDay({ open: false, from: "09:00", to: "17:00", breaks: [] })).toBe("Closed");
    expect(describeDay({ open: true, from: "09:00", to: "17:00", breaks: [{ from: "13:00", to: "14:00" }] })).toContain("break 13:00 – 14:00");
  });
});

describe("routing", () => {
  it("only allow-listed paths are served as the public site", () => {
    for (const p of ["/", "/about", "/services", "/services/x", "/doctors/y", "/articles/z", "/contact", "/book-appointment", "/sitemap.xml", "/robots.txt"]) expect(isPublicSitePath(p)).toBe(true);
    for (const p of ["/dashboard", "/team", "/settings", "/website", "/api/users", "/login", "/platform/clinics", "/preview", "/invite/abc", "/site/x"]) expect(isPublicSitePath(p)).toBe(false);
  });
  it("resolves routes and rejects junk", () => {
    expect(resolveSiteRoute([])).toEqual({ page: "home" });
    expect(resolveSiteRoute(["services", "general"])).toEqual({ page: "service", slug: "general" });
    expect(resolveSiteRoute(["book-appointment"])).toEqual({ page: "appointments" });
    for (const bad of [["nope"], ["services", "A_B"], ["services", "x", "y"], ["services", "../x"], ["about", "x"]]) expect(resolveSiteRoute(bad)).toBeNull();
  });
  it("tenant hosts decide the site; the platform host does not", () => {
    expect(parseTenantHost("clinic-a.mecgura.com", "mecgura.com")).toEqual({ kind: "subdomain", value: "clinic-a" });
    expect(parseTenantHost("www.drxyz.com", "mecgura.com")).toEqual({ kind: "custom", value: "www.drxyz.com" });
    expect(parseTenantHost("mecgura.com", "mecgura.com")).toBeNull();
    expect(parseTenantHost("localhost:3000", "mecgura.com")).toBeNull();
  });
});

describe("pages only appear when real", () => {
  it("empty site: only home, contact, appointments (+ clinic once address/phone exist)", () => {
    expect([...availablePages(site())].sort()).toEqual(["appointments", "clinic", "contact", "home"]);
    const bare = site({ identity: { ...site().identity, address: null, phone: null } });
    expect([...availablePages(bare)].sort()).toEqual(["appointments", "contact", "home"]);
  });
  it("services/doctors/faq/articles appear with content and respect switches", () => {
    const c = emptyContent(); c.pages.services = false;
    const s = site({ content: c, services: [svc], faqs: [{ question: "q", answer: "a", category: null, isDraft: false }], articleTotal: 2 });
    const on = availablePages(s);
    expect(on.has("services")).toBe(false);
    expect(on.has("faq")).toBe(true);
    expect(on.has("articles")).toBe(true);
    expect(on.has("privacy")).toBe(false);
  });
  it("navigation honours order/labels/visibility and hides empty pages", () => {
    const c = emptyContent();
    c.navigation = [{ key: "contact", label: "Reach us", visible: true }, { key: "services", label: "Svc", visible: true }, { key: "faq", label: "FAQ", visible: false }];
    expect(navigationFor(site({ content: c })).map((n) => n.label)).toEqual(["Reach us"]);
    expect(navigationFor(site({ content: c, services: [svc] })).map((n) => n.label)).toEqual(["Reach us", "Svc"]);
  });
});

describe("SEO, sitemap, robots, structured data", () => {
  it("home & page metadata with canonical + OG, noindex in preview", () => {
    const s = site();
    const seo = seoFor({ page: "services" }, s);
    const md = toMetadata(seo, s, "https://clinic.example");
    expect((md.alternates as { canonical: string }).canonical).toBe("https://clinic.example/services");
    expect(JSON.stringify(md.title)).toContain("Services | Test Clinic");
    expect(md.robots).toMatchObject({ index: true });
    expect(toMetadata(seoFor({ page: "home" }, site({ mode: "preview" })), site({ mode: "preview" }), "https://x.test").robots).toMatchObject({ index: false });
  });
  it("sitemap lists only available pages and published entries; robots blocks app areas", () => {
    const s = site({ services: [svc] });
    const xml = buildSitemap("https://c.test", s, { services: [{ slug: "s1", updatedAt: new Date() }], doctors: [], articles: [] });
    expect(xml).toContain("https://c.test/services/s1");
    expect(xml).toContain("https://c.test/contact");
    expect(xml).not.toContain("/faq");
    expect(xml).not.toContain("/book-appointment");
    const robots = buildRobots("https://c.test", { indexable: true });
    for (const d of ["/api/", "/dashboard", "/website", "/preview", "/platform"]) expect(robots).toContain(`Disallow: ${d}`);
    expect(buildRobots("https://c.test", { indexable: false })).toContain("Disallow: /\n");
  });
  it("JSON-LD uses real fields only: no ratings/reviews; '<' is escaped", () => {
    const s = site(); s.content.clinic.hours.monday = { open: true, from: "09:00", to: "17:00", breaks: [] };
    const ld = jsonLdFor(s, "https://c.test");
    expect(ld["@type"]).toBe("MedicalClinic");
    expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|review/i);
    expect(JSON.stringify(ld)).toContain("OpeningHoursSpecification");
    expect(jsonLdString({ n: "</script><script>alert(1)" })).not.toContain("</script>");
  });
  it("whatsapp CTA only from a configured number", () => {
    expect(whatsappUrl("")).toBeNull();
    expect(whatsappUrl("919876543210")).toBe("https://wa.me/919876543210");
  });
});

describe("template architecture", () => {
  it("registry returns a complete template and falls back safely", () => {
    expect(Object.keys(TEMPLATES)).toContain("MODERN_MEDICAL");
    expect(getTemplate("DOES_NOT_EXIST").key).toBe("MODERN_MEDICAL");
    for (const k of ["Layout", "Home", "About", "Services", "ServiceDetail", "Doctors", "DoctorDetail", "Clinic", "Testimonials", "Faq", "Articles", "ArticleDetail", "Contact", "Legal", "Appointments"]) {
      expect(typeof (getTemplate("MODERN_MEDICAL").components as unknown as Record<string, unknown>)[k]).toBe("function");
    }
  });
});
