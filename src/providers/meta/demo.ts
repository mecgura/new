import { randomInt } from "node:crypto";

/**
 * Demo provider — produces obviously fictional Meta objects so the onboarding
 * UI can be exercised without Meta credentials. Ids are prefixed "DEMO-" and
 * numbers use the fictional +1 202 555-01xx range. Nothing here talks to Meta.
 */
export function demoIds() {
  const n = randomInt(0, 10_000).toString().padStart(4, "0");
  const suffix = `${Date.now().toString(36)}${randomInt(0, 1e6).toString(36)}`.toUpperCase();
  return {
    wabaId: `DEMO-WABA-${suffix}`,
    phoneNumberId: `DEMO-PN-${suffix}`,
    businessPortfolioId: `DEMO-BP-${suffix}`,
    e164: `+1202555${n}`,
    display: `+1 202-555-${n}`,
  };
}

export const DEMO_PERMISSIONS = ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"] as const;
