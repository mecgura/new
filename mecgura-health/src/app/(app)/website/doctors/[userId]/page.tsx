import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DoctorEditor } from "@/components/website/doctor-editor";
import { Alert, Breadcrumb } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getDoctorForEdit } from "@/lib/services/website-doctors";
import type { Values } from "@/components/website/fields";

export const metadata: Metadata = { title: "Doctor public profile" };

export default async function DoctorEdit({ params }: { params: Promise<{ userId: string }> }) {
  const ctx = await requireTenantPagePermission("website.view");
  const { userId } = await params;
  const d = await getDoctorForEdit(ctx, userId).catch((e) => { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; });
  const p = d.profile;
  const initial: Values = {
    photoUrl: p?.photoUrl ?? "", photoAlt: p?.photoAlt ?? "", shortBio: p?.shortBio ?? "", bio: p?.bio ?? "", education: p?.education ?? "",
    certifications: p?.certifications ?? [], memberships: p?.memberships ?? [], languages: p?.languages ?? [], philosophy: p?.philosophy ?? "",
    showRegistration: p?.showRegistration ?? false, showFee: p?.showFee ?? false, slug: p?.slug ?? "", sortOrder: String(p?.sortOrder ?? 0), seoTitle: p?.seoTitle ?? "", seoDescription: p?.seoDescription ?? "",
  };
  return (
    <div className="space-y-section">
      <div><Breadcrumb items={[{ label: "Website", href: "/website" }, { label: "Doctors", href: "/website/doctors" }, { label: d.name }]} /><h2 className="type-page-title">{d.name}</h2></div>
      <Alert tone="info" title="From the Team record">
        {[d.clinical?.qualification, d.clinical?.specialization, d.clinical?.experienceYears != null ? `${d.clinical.experienceYears} years` : null].filter(Boolean).join(" · ") || "No qualification, specialization or experience entered yet."} These are shown as entered in Team; nothing here is invented.
      </Alert>
      <DoctorEditor userId={userId} initial={initial} status={p?.status ?? null} editable={d.editable} canPublish={ctx.permissions.has("website.publish")} />
    </div>
  );
}
