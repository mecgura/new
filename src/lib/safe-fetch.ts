import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Private, loopback, link-local, CGNAT, multicast and reserved ranges — never reachable from user-configured webhooks. */
export function isBlockedAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return isBlockedAddress(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

export class UnsafeUrlError extends Error {}

/** Resolves the host and refuses internal destinations (SSRF guard). */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL.");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only https:// URLs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("URLs can't contain credentials.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new UnsafeUrlError("Internal hosts aren't allowed.");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => {
    throw new UnsafeUrlError("The host name doesn't resolve.");
  });
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) throw new UnsafeUrlError("Private or internal network addresses aren't allowed.");
  return url;
}
