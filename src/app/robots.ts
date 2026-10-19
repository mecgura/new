import type { MetadataRoute } from "next";

// The landing page and legal pages are public; the application itself is private.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/privacy", "/terms", "/data-deletion"],
        disallow: ["/api/", "/admin", "/dashboard", "/inbox", "/login", "/settings", "/billing", "/whatsapp", "/contacts", "/templates", "/campaigns", "/automations", "/flows", "/ai", "/webhooks", "/analytics", "/team"],
      },
    ],
  };
}
