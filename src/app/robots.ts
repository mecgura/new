import type { MetadataRoute } from "next";

// A private application: only the public legal pages may be crawled.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: ["/privacy", "/terms", "/data-deletion"], disallow: "/" }] };
}
