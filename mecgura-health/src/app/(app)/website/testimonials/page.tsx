import type { Metadata } from "next";
import { ResourceManager, type ManagerRow } from "@/components/website/resource-manager";
import { Alert } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { tenantDb } from "@/lib/tenant/db";
import { TESTIMONIAL_BLANK, testimonialFields } from "@/lib/website/cms-config";
import { listItems } from "@/lib/services/website-items";

export const metadata: Metadata = { title: "Website testimonials" };

export default async function TestimonialsCms() {
  const ctx = await requireTenantPagePermission("website.edit");
  const tdb = tenantDb(ctx);
  const [{ rows }, doctors, services] = await Promise.all([
    listItems(ctx, "testimonials", {}),
    tdb.user.findMany({ where: { role: { key: "DOCTOR" }, status: { not: "DISABLED" } }, select: { id: true, name: true } }),
    tdb.websiteService.findMany({ where: { deletedAt: null }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);
  const items: ManagerRow[] = rows.map((r: { id: string; displayName: string | null; text: string; rating: number | null; givenOn: Date | null; doctorUserId: string | null; serviceId: string | null; sortOrder: number; status: string; updatedAt: Date }) => ({
    id: r.id, title: r.text.length > 90 ? `${r.text.slice(0, 90)}…` : r.text, subtitle: `${r.displayName || "Anonymous Patient"}${r.rating ? ` · ${r.rating}/5` : ""}`, status: r.status, updated: r.updatedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
    values: { text: r.text, displayName: r.displayName ?? "", rating: r.rating ? String(r.rating) : "", givenOn: r.givenOn ? r.givenOn.toISOString().slice(0, 10) : "", doctorUserId: r.doctorUserId ?? "", serviceId: r.serviceId ?? "", sortOrder: String(r.sortOrder) },
  }));
  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Real feedback only">Only add testimonials patients have agreed to share. Leave the name blank to show “Anonymous Patient”. Never write or edit feedback on a patient&apos;s behalf.</Alert>
      <ResourceManager resource="testimonials" noun="Testimonial" fields={testimonialFields(doctors.map((x) => ({ value: x.id, label: x.name })), services.map((x) => ({ value: x.id, label: x.title })))} blank={TESTIMONIAL_BLANK} rows={items} canCreate canEdit canPublish={ctx.permissions.has("website.publish")} emptyHint="No testimonials yet." />
    </div>
  );
}
