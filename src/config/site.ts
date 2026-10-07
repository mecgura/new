/** Product identity + support contact. Domain-specific values come from the environment, never hardcoded. */
export const siteConfig = {
  name: "MECGURA",
  product: "MECGURA Platform",
  description: "WhatsApp automation for businesses: shared inbox, CRM, campaigns, automations, Flows and an AI agent — with a Super Admin console.",
  /** This app's own public URL (webhook callback URLs, password-reset links, canonical URLs). */
  url: (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** Optional support contact shown in the Help menu. Nothing is shown when these are not set. */
  contact: {
    email: (process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "").trim(),
    whatsapp: (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "").replace(/\D/g, ""),
  },
} as const;

export type SiteConfig = typeof siteConfig;
