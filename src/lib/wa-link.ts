/** wa.me links: country code first, digits only. A bare 10-digit Indian mobile gets 91. Returns null when it can't be a WhatsApp number. */
export function waDigits(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (/^0[6-9]\d{9}$/.test(d)) d = d.slice(1);
  if (/^[6-9]\d{9}$/.test(d)) d = `91${d}`;
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}

export function waLink(digits: string, message = "") {
  const text = message.trim().slice(0, 1000);
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Cost of a month of WhatsApp templates at the given rates (paise per message). Service replies are always free. */
export function monthlyCost(rates: { marketing: number; utility: number; authentication: number }, n: { marketing: number; utility: number; utilityFree: number; authentication: number }) {
  const utilityPaid = Math.max(0, n.utility - Math.min(n.utility, n.utilityFree));
  const parts = {
    marketing: (n.marketing * rates.marketing) / 100,
    utility: (utilityPaid * rates.utility) / 100,
    authentication: (n.authentication * rates.authentication) / 100,
  };
  const total = parts.marketing + parts.utility + parts.authentication;
  const count = n.marketing + n.utility + n.authentication;
  return { ...parts, total, perMessage: count ? total / count : 0, utilityPaid };
}
