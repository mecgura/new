import type { Metadata } from "next";
import { ResourceManager, type ManagerRow } from "@/components/website/resource-manager";
import { Alert } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { ARTICLE_BLANK, ARTICLE_FIELDS } from "@/lib/website/cms-config";
import { listItems, rowTags } from "@/lib/services/website-items";

export const metadata: Metadata = { title: "Website articles" };
const s = (v: unknown) => (v == null ? "" : String(v));

export default async function ArticlesCms() {
  const ctx = await requireTenantPagePermission("website.view");
  const canEdit = ctx.permissions.has("website.edit"), canWrite = canEdit || ctx.permissions.has("website.articles");
  const { rows } = await listItems(ctx, "articles", {});
  const items: ManagerRow[] = rows.map((r: Record<string, unknown> & { id: string; title: string; status: string; updatedAt: Date; tags: string; publishedAt: Date | null }) => ({
    id: r.id, title: r.title, subtitle: s(r.category), status: r.status, updated: r.updatedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
    values: { title: r.title, excerpt: s(r.excerpt), content: s(r.content), category: s(r.category), tags: rowTags(r), featuredImageUrl: s(r.featuredImageUrl), featuredImageAlt: s(r.featuredImageAlt), publishAt: r.publishedAt ? r.publishedAt.toISOString().slice(0, 10) : "", slug: s(r.slug), seoTitle: s(r.seoTitle), seoDescription: s(r.seoDescription), canonicalUrl: s(r.canonicalUrl), ogImageUrl: s(r.ogImageUrl) },
  }));
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Medical content">Articles are general information, never a diagnosis or treatment advice for an individual. Every article is reviewed by a person before it is published, and the public page carries a standard “not a substitute for professional medical advice” note.</Alert>
      <ResourceManager resource="articles" noun="Article" fields={ARTICLE_FIELDS} blank={ARTICLE_BLANK} rows={items} canCreate={canWrite} canEdit={canWrite} canPublish={ctx.permissions.has("website.publish")} emptyHint="Write your first health article." publishNote={canEdit ? undefined : "You can write and edit your own drafts. A Clinic Admin publishes them."} />
    </div>
  );
}
