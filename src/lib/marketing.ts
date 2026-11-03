// Pure marketing constants and copy, shared by the server and the admin screens.

export const STAGES = ["new", "contacted", "demo", "proposal", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = { new: "New", contacted: "Contacted", demo: "Demo", proposal: "Proposal", won: "Won", lost: "Lost" };

export const SOURCES = ["website_chat", "whatsapp", "demo_click", "festival", "referral", "manual"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABELS: Record<Source, string> = {
  website_chat: "Website chat",
  whatsapp: "WhatsApp",
  demo_click: "Demo button",
  festival: "Festival offer",
  referral: "Client referral",
  manual: "Added by hand",
};

/** A ready WhatsApp message for the next step, so following up takes one tap. */
export function followUpText(l: { name: string; stage: string; business: string }): string {
  const hi = `Hi${l.name ? ` ${l.name.split(" ")[0]}` : ""}`;
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
