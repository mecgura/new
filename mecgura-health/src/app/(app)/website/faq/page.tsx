import type { Metadata } from "next";
import { ResourceManager, type ManagerRow } from "@/components/website/resource-manager";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { FAQ_BLANK, FAQ_FIELDS } from "@/lib/website/cms-config";
import { listItems } from "@/lib/services/website-items";

export const metadata: Metadata = { title: "Website FAQ" };

export default async function FaqCms() {
  const ctx = await requireTenantPagePermission("website.edit");
  const { rows } = await listItems(ctx, "faq", {});
  const items: ManagerRow[] = rows.map((r: { id: string; question: string; answer: string; category: string | null; sortOrder: number; status: string; updatedAt: Date }) => ({
    id: r.id, title: r.question, subtitle: r.category ?? undefined, status: r.status, updated: r.updatedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
    values: { question: r.question, answer: r.answer, category: r.category ?? "", sortOrder: String(r.sortOrder) },
  }));
  return <ResourceManager resource="faq" noun="Question" fields={FAQ_FIELDS} blank={FAQ_BLANK} rows={items} canCreate canEdit canPublish={ctx.permissions.has("website.publish")} emptyHint="Add questions patients commonly ask." />;
}
