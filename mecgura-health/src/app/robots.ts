import type { MetadataRoute } from "next";

/** The staff application (platform host / localhost) is never indexed. Clinic sites get their own robots.txt via the host rewrite. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
