import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { OrgAccess } from "@/lib/session";
import { PublishError } from "@/lib/onepost-publish";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { accessTokenFor } from "@/services/onepost/connections";
import { gscPerformance, type GscResult } from "@/providers/onepost/search-console";

export type SearchSummary = { available: boolean; note: string; data?: GscResult };

/** Search performance from the connected Search Console site. Never throws for "not connected": the report just says so. */
export async function searchSummary(organizationId: string, from: Date, to: Date): Promise<SearchSummary> {
  const c = await db.onePostConnection.findFirst({ where: { organizationId, provider: "gsc" }, orderBy: { createdAt: "desc" } });
  if (!c) return { available: false, note: "Google Search Console is not connected. Connect it in OnePost → Connections to see search clicks and keywords." };
  if (c.status === "needs_target" || !c.externalId) return { available: false, note: "Choose the website for Search Console in OnePost → Connections." };
  try {
    const token = await accessTokenFor(c);
    return { available: true, note: "", data: await gscPerformance(token, c.externalId, from, to) };
  } catch (e) {
    return { available: false, note: e instanceof PublishError ? e.message : "Search Console could not be reached. Try again later." };
  }
}

export async function seoOverview(a: OrgAccess, days: number) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  if (!Number.isInteger(days) || days < 7 || days > 90) throw new ApiError("VALIDATION_ERROR", "Choose 7 to 90 days.");
  const to = new Date(Date.now() - 2 * 86_400_000); // Search Console data lags about two days
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  const s = await searchSummary(a.organizationId, from, to);
  return { days, ...s };
}
