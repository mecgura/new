import { cookies } from "next/headers";

/** Per-browser preference: which of the workspace's WhatsApp numbers the dashboard, inbox and new campaigns/automations default to. */
export const ACTIVE_NUMBER_COOKIE = "mecgura_number";

/** Cookie value is `<orgId>.<accountId>`, so a value left over from another workspace is ignored. */
export const encodeActiveNumber = (orgId: string, accountId: string) => `${orgId}.${accountId}`;

/** The saved number, only if it is still one of this workspace's usable numbers; otherwise "" (= all numbers). */
export async function readActiveNumber(orgId: string, usableIds: readonly string[]): Promise<string> {
  const raw = (await cookies()).get(ACTIVE_NUMBER_COOKIE)?.value ?? "";
  const [org, account] = raw.split(".");
  return org === orgId && account && usableIds.includes(account) ? account : "";
}
