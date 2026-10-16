import type { Metadata } from "next";

export interface SeoInput {
  title: string;
  description: string;
  /** Path ("/about") or absolute URL; resolved against `baseUrl` */
  path?: string;
  baseUrl?: string;
  image?: string;
  siteName?: string;
  /** Internal app pages should stay out of search engines */
  noIndex?: boolean;
  faviconUrl?: string;
}

/**
 * Builds Next.js Metadata (title, description, canonical, Open Graph, Twitter, favicon).
 * Public doctor websites (later phase) call this per page with the tenant's name/domain.
 */
export function buildMetadata(input: SeoInput): Metadata {
  const siteName = input.siteName ?? "MECGURA HEALTH";
  const canonical = input.baseUrl && input.path !== undefined ? new URL(input.path, input.baseUrl).toString() : undefined;
  return {
    title: input.title,
    description: input.description,
    ...(input.baseUrl ? { metadataBase: new URL(input.baseUrl) } : {}),
    alternates: canonical ? { canonical } : undefined,
    robots: input.noIndex ? { index: false, follow: false } : { index: true, follow: true },
    icons: input.faviconUrl ? { icon: input.faviconUrl } : undefined,
    openGraph: { title: input.title, description: input.description, siteName, type: "website", url: canonical, images: input.image ? [input.image] : undefined },
    twitter: { card: input.image ? "summary_large_image" : "summary", title: input.title, description: input.description, images: input.image ? [input.image] : undefined },
  };
}

/** schema.org JSON-LD for a clinic/physician page. Render with <JsonLd/> later. */
export function medicalBusinessJsonLd(t: { name: string; url?: string; phone?: string | null; email?: string | null; address?: string | null }) {
  return {
    "@context": "https://schema.org",
    "@type": "MedicalClinic",
    name: t.name,
    url: t.url,
    telephone: t.phone ?? undefined,
    email: t.email ?? undefined,
    address: t.address ? { "@type": "PostalAddress", streetAddress: t.address } : undefined,
  };
}
