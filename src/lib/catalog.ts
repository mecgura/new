// Pure product catalog constants — safe for client components.

export const SERVICES = [
  { key: "WHATSAPP_AUTOMATION", label: "WhatsApp Automation", description: "Inbox, templates, campaigns and flows" },
  { key: "CRM", label: "CRM", description: "Contacts, leads and pipelines" },
  { key: "SOCIAL_MEDIA", label: "Social Media Management", description: "Coming soon: content calendar and publishing" },
  { key: "ATS", label: "ATS (Applicant Tracking)", description: "Coming soon: job openings and candidates" },
  { key: "HRMS", label: "HRMS", description: "Coming soon: employees, attendance and leave" },
  { key: "AI_ASSISTANT", label: "AI Assistant", description: "AI Agent: automatic replies, lead qualification and appointment requests (also needs a plan that includes it)" },
  { key: "OMNICHANNEL", label: "Omnichannel inbox", description: "Email, website chat, Messenger and Instagram in the shared inbox" },
  { key: "ADS_MANAGER", label: "Ads Manager", description: "Create and run click-to-WhatsApp ads from MECGURA and see chats and cost per chat (needs Meta approval for other businesses' ad accounts)" },
  { key: "AI_CALLING", label: "AI Calling", description: "AI phone calls with transcripts and summaries (practice mode until a voice provider is connected)" },
] as const;

/** Services that switch a whole module on or off in the client's sidebar and APIs (the rest are labels or plan features). */
export const GATED_SERVICES = ["OMNICHANNEL", "AI_CALLING", "AI_ASSISTANT", "ADS_MANAGER"] as const;

export type ServiceKey = (typeof SERVICES)[number]["key"];
export const SERVICE_KEYS = SERVICES.map((s) => s.key) as [ServiceKey, ...ServiceKey[]];
export const SERVICE_LABELS = Object.fromEntries(SERVICES.map((s) => [s.key, s.label])) as Record<ServiceKey, string>;

/** WhatsAppAccount statuses that occupy a plan slot. */
export const ACTIVE_NUMBER_STATUSES = ["pending", "connected", "demo"];

export const QUALITY_LABELS: Record<string, string> = { GREEN: "High", YELLOW: "Medium", RED: "Low", UNKNOWN: "Not rated" };

export const CONNECTION_METHOD_LABELS: Record<string, string> = {
  embedded_signup: "Meta Embedded Signup",
  coexistence: "Existing WhatsApp Business (coexistence)",
  manual: "API / developer setup",
  demo: "Demo",
};

export const USAGE_METRICS = ["messages_sent", "contacts_created", "ai_replies", "api_calls", "campaigns_launched"] as const; // ai_replies: live (Claude) replies only
export type UsageMetric = (typeof USAGE_METRICS)[number];

export const WHATSAPP_STATUS_LABELS: Record<string, string> = {
  pending: "Pending connection",
  connected: "Connected",
  demo: "Demo (not live)",
  disconnected: "Disconnected",
  disabled: "Disabled",
};

/**
 * Indian digit grouping (12,34,567) done by hand so server and browser output
 * is byte-identical (Intl data differs between Node and browsers → hydration errors).
 */
export function groupIndian(n: number): string {
  const neg = n < 0;
  const s = String(Math.abs(Math.trunc(n)));
  const grouped = s.length <= 3 ? s : `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${s.slice(-3)}`;
  return neg ? `-${grouped}` : grouped;
}

/** Indian compact form: 1.5K, 2.3L, 1.2Cr. */
export function compactIndian(n: number): string {
  const trim = (x: number) => (Math.round(x * 10) / 10).toString();
  if (n >= 1e7) return `${trim(n / 1e7)}Cr`;
  if (n >= 1e5) return `${trim(n / 1e5)}L`;
  if (n >= 1e3) return `${trim(n / 1e3)}K`;
  return String(Math.round(n));
}

/** Paise → "₹4,999" (paise shown only when non-zero). */
export function formatINR(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const p = Math.abs(paise % 100);
  return `₹${groupIndian(rupees)}${p ? `.${String(p).padStart(2, "0")}` : ""}`;
}

export function formatNumber(n: number): string {
  return groupIndian(n);
}
