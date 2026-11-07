// Pure marketing constants and copy, shared by the server and the admin screens.

export const STAGES = ["new", "contacted", "demo", "proposal", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = { new: "New", contacted: "Contacted", demo: "Demo", proposal: "Proposal", won: "Won", lost: "Lost" };

export const SOURCES = ["website_chat", "website_form", "whatsapp", "demo_click", "festival", "referral", "maps", "manual"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABELS: Record<Source, string> = {
  website_chat: "Website chat",
  website_form: "Website form",
  whatsapp: "WhatsApp",
  demo_click: "Demo button",
  festival: "Festival offer",
  referral: "Client referral",
  maps: "Google Maps search",
  manual: "Added by hand",
};

/** A ready WhatsApp message for the next step, so following up takes one tap. */
export function followUpText(l: { name: string; stage: string; business: string; source?: string }): string {
  const hi = `Hi${l.name ? ` ${l.name.split(" ")[0]}` : ""}`;
  // Found on Maps: they never asked, so the first message introduces MECGURA and makes saying no easy.
  if (l.source === "maps" && l.stage === "new")
    return `${hi}, I'm Gurjeet from MECGURA 🙏 I saw ${l.business || "your business"} on Google Maps. We set up WhatsApp so every customer message gets an instant reply. Can I show you a 10-minute demo? If not interested, just say no and I won't message again.`;
  switch (l.stage) {
    case "new":
      return `${hi}, this is Gurjeet from MECGURA 👋 Thanks for your interest in WhatsApp automation${l.business ? ` for ${l.business}` : ""}. When is a good time for a quick 15-minute demo?`;
    case "contacted":
      return `${hi}, just following up from MECGURA. I can show you how automatic replies, broadcasts and lead follow-ups would work for your business in a 15-minute demo. Today or tomorrow?`;
    case "demo":
      return `${hi}, thanks for your time in the demo! Shall I share the plan and the setup steps? We can get your number live within a day.`;
    case "proposal":
      return `${hi}, did you get a chance to look at the MECGURA proposal? Happy to answer any questions, and the setup can start as soon as you confirm.`;
    case "won":
      return `${hi}, welcome to MECGURA! 🎉 If you need anything with your WhatsApp setup, just message me here.`;
    default:
      return `${hi}, hope business is going well! MECGURA has new WhatsApp automation features this month. Would you like a quick look?`;
  }
}

/** Fills an outreach template: {name}, {business}, {city}, {category}. Empty values drop cleanly. */
export function fillTemplate(template: string, v: { name?: string; business?: string; city?: string; category?: string }): string {
  return template
    .replace(/\{name\}/g, (v.name ?? "").split(" ")[0] || "there")
    .replace(/\{business\}/g, v.business || "your business")
    .replace(/\{city\}/g, v.city || "your city")
    .replace(/\{category\}/g, v.category || "business")
    .trim();
}
