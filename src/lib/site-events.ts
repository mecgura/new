/** Optional third-party analytics events. They do nothing unless Google Analytics / Meta Pixel are switched on for the site. */
type Win = Window & { gtag?: (...a: unknown[]) => void; fbq?: (...a: unknown[]) => void };

export function trackLead(source: string) {
  try {
    const w = window as Win;
    w.gtag?.("event", "generate_lead", { lead_source: source });
    w.fbq?.("track", "Lead");
  } catch {
    /* analytics blocked: ignore */
  }
}

export function trackContact(name: string) {
  try {
    const w = window as Win;
    w.gtag?.("event", "contact_click", { click_name: name });
    w.fbq?.("track", "Contact");
  } catch {
    /* analytics blocked: ignore */
  }
}
