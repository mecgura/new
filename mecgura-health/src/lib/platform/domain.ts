import { randomBytes } from "node:crypto";

/** Custom-domain verification (pure parts). The clinic proves control of the domain with a DNS TXT record. */
export const TXT_PREFIX = "_mecgura-verify";
export const TXT_VALUE_PREFIX = "mecgura-verify=";
export const newDomainToken = () => randomBytes(18).toString("base64url");
export const txtRecordName = (domain: string) => `${TXT_PREFIX}.${domain}`;
export const txtRecordValue = (token: string) => `${TXT_VALUE_PREFIX}${token}`;
/** `records` is what DNS returned: an array of TXT records, each an array of string chunks. */
export function txtMatches(records: string[][], token: string): boolean {
  const want = txtRecordValue(token);
  return records.some((chunks) => chunks.join("") === want);
}
/** Platform / reserved hosts that a clinic must never be able to claim. */
export function isClaimableHost(host: string, rootDomain?: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  const root = rootDomain?.toLowerCase();
  if (root && (h === root || h.endsWith(`.${root}`))) return false;
  return true;
}
