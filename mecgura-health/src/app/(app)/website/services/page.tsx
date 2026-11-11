import type { Metadata } from "next";
import { ResourceManager, type ManagerRow } from "@/components/website/resource-manager";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { SERVICE_BLANK, SERVICE_FIELDS } from "@/lib/website/cms-config";
import { listItems } from "@/lib/services/website-items";

export const metadata: Metadata = { title: "Website services" };
const d = (x: Date) => x.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const s = (v: unknown) => (v == null ? "" : String(v));

export default async function ServicesCms() {
  const ctx = await requireTenantPagePermission("website.edit");
  const { rows } = await listItems(ctx, "services", {});
  const items: ManagerRow[] = rows.map((r: Record<string, unknown> & { id: string; title: string; status: string; updatedAt: Date }) => ({
    id: r.id, title: r.title, subtitle: [r.category, r.durationMinutes ? `${r.durationMinutes} min` : null].filter(Boolean).join(" · "), status: r.status, updated: d(r.updatedAt),
    values: { ...SERVICE_BLANK, title: r.title, category: s(r.category), shortDescription: s(r.shortDescription), description: s(r.description), durationMinutes: s(r.durationMinutes), fee: s(r.fee), showFee: !!r.showFee, icon: s(r.icon), imageUrl: s(r.imageUrl), imageAlt: s(r.imageAlt), slug: s(r.slug), sortOrder: s(r.sortOrder), seoTitle: s(r.seoTitle), seoDescription: s(r.seoDescription) },
  }));
  return <ResourceManager resource="services" noun="Service" fields={SERVICE_FIELDS} blank={SERVICE_BLANK} rows={items} canCreate canEdit canPublish={ctx.permissions.has("website.publish")} emptyHint="Add the consultations and services you really offer. Nothing is added for you." publishNote="Published services are visible immediately when you save changes to them. Drafts are never public." />;
}
