import { PublishError } from "@/lib/onepost-publish";
import { bearer, http } from "@/providers/onepost/http";

/** Websites the signed-in person can read in Search Console. */
export async function gscSites(token: string): Promise<{ id: string; name: string }[]> {
  const r = await http<{ siteEntry?: { siteUrl?: string; permissionLevel?: string }[] }>("https://www.googleapis.com/webmasters/v3/sites", { label: "Search Console", headers: bearer(token) });
  return (r.json.siteEntry ?? []).filter((s) => s.siteUrl && s.permissionLevel !== "siteUnverifiedUser").map((s) => ({ id: s.siteUrl!, name: s.siteUrl!.replace(/^sc-domain:/, "Domain: ") }));
}

export type GscRow = { key: string; clicks: number; impressions: number; ctr: number; position: number };
export type GscResult = { totals: { clicks: number; impressions: number; ctr: number; position: number }; queries: GscRow[]; pages: GscRow[]; from: string; to: string };

async function query(token: string, site: string, body: Record<string, unknown>) {
  const r = await http<{ rows?: { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }[] }>(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    label: "Search Console",
    method: "POST",
    headers: { ...bearer(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json.rows ?? [];
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Clicks, impressions, top keywords and top pages for a site over a date range (Search Console data lags by about two days). */
export async function gscPerformance(token: string, site: string, from: Date, to: Date): Promise<GscResult> {
  if (!site) throw new PublishError("Choose a Search Console website first.", false);
  const range = { startDate: isoDay(from), endDate: isoDay(to) };
  const [total, q, p] = await Promise.all([query(token, site, { ...range }), query(token, site, { ...range, dimensions: ["query"], rowLimit: 25 }), query(token, site, { ...range, dimensions: ["page"], rowLimit: 10 })]);
  const t = total[0];
  const row = (r: (typeof q)[number]): GscRow => ({ key: r.keys?.[0] ?? "", clicks: r.clicks ?? 0, impressions: r.impressions ?? 0, ctr: r.ctr ?? 0, position: r.position ?? 0 });
  return { totals: { clicks: t?.clicks ?? 0, impressions: t?.impressions ?? 0, ctr: t?.ctr ?? 0, position: t?.position ?? 0 }, queries: q.map(row), pages: p.map(row), from: range.startDate, to: range.endDate };
}
