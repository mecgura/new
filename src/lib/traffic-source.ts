// Where a website visitor came from. Pure, so the browser tracker and the server agree.

const KNOWN: [RegExp, string][] = [
  [/(^|\.)instagram\.com$|^ig$|^insta(gram)?$/i, "instagram"],
  [/(^|\.)(facebook|fb)\.com$|^fb$|^facebook$|^meta$/i, "facebook"],
  [/(^|\.)google\.|^google$|^gads$/i, "google"],
  [/(^|\.)youtube\.com$|^youtube$|^yt$/i, "youtube"],
  [/(^|\.)(whatsapp\.com|wa\.me)$|^whatsapp$|^wa$/i, "whatsapp"],
  [/(^|\.)linkedin\.com$|^linkedin$/i, "linkedin"],
  [/(^|\.)bing\.com$|^bing$/i, "bing"],
];

/** "instagram", "google", "direct"… from utm_source first, else the referring site (our own site counts as direct). */
export function sourceOf(utmSource: string, referrer: string, ownHost = ""): string {
  const tag = utmSource.trim().toLowerCase();
  if (tag) return KNOWN.find(([re]) => re.test(tag))?.[1] ?? tag.replace(/[^a-z0-9._-]/g, "").slice(0, 40);
  if (!referrer) return "direct";
  let host = "";
  try {
    host = new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "direct";
  }
  if (!host || (ownHost && host === ownHost.replace(/^www\./, ""))) return "direct";
  return KNOWN.find(([re]) => re.test(host))?.[1] ?? host.slice(0, 40);
}
