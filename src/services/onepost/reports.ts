import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { OrgAccess } from "@/lib/session";
import { istToDate } from "@/lib/onepost-publish";
import { PUBLISH_LABELS, isPublishChannel } from "@/lib/onepost-publish";
import { reportPdf, type ReportData } from "@/lib/onepost-docs";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { searchSummary } from "@/services/onepost/seo";

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Month bounds in India time. */
function bounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: istToDate(`${month}-01T00:00`)!, to: istToDate(`${next}-01T00:00`)! };
}

export async function buildReport(a: OrgAccess, month: string): Promise<ReportData> {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  if (!MONTH_RE.test(month)) throw new ApiError("VALIDATION_ERROR", "Choose a month like 2026-11.");
  const { from, to } = bounds(month);
  const org = a.organizationId;
  const [brand, orgRow, posts, deliveries, pitches] = await Promise.all([
    db.onePostBrand.findUnique({ where: { organizationId: org }, select: { businessName: true } }),
    db.organization.findUnique({ where: { id: org }, select: { name: true } }),
    db.onePost.findMany({ where: { organizationId: org, createdAt: { gte: from, lt: to } }, select: { status: true } }),
    db.onePostDelivery.findMany({ where: { organizationId: org, OR: [{ publishedAt: { gte: from, lt: to } }, { status: "failed", updatedAt: { gte: from, lt: to } }] }, include: { post: { select: { title: true } } }, orderBy: { publishedAt: "asc" }, take: 500 }),
    db.onePostPitch.findMany({ where: { organizationId: org, sentAt: { gte: from, lt: to } }, select: { openedAt: true, coverageUrl: true } }),
  ]);
  const byStatus: Record<string, number> = {};
  for (const p of posts) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  const done = deliveries.filter((d) => d.status === "published");
  const counts = new Map<string, number>();
  for (const d of done) counts.set(d.channel, (counts.get(d.channel) ?? 0) + 1);
  const label = (c: string) => (isPublishChannel(c) ? PUBLISH_LABELS[c] : c);
  const s = await searchSummary(org, from, new Date(Math.min(to.getTime(), Date.now() - 2 * 86_400_000)));
  return {
    business: brand?.businessName || orgRow?.name || "",
    month,
    generatedAt: new Date().toISOString(),
    posts: { created: posts.length, byStatus },
    published: [...counts].map(([channel, count]) => ({ channel, label: label(channel), count })),
    failed: deliveries.filter((d) => d.status === "failed").length,
    items: deliveries.map((d) => ({ title: d.post.title, channel: label(d.channel), status: d.status, at: (d.publishedAt ?? d.updatedAt).toISOString(), url: d.externalUrl })),
    pr: { sent: pitches.length, opened: pitches.filter((p) => p.openedAt).length, covered: pitches.filter((p) => p.coverageUrl).length },
    search: s.data ? { available: true, note: "", totals: s.data.totals, queries: s.data.queries } : { available: false, note: s.note },
  };
}

export async function buildReportPdf(a: OrgAccess, month: string) {
  return reportPdf(await buildReport(a, month));
}
