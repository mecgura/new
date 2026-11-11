import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { WebsiteTabs } from "@/components/website/tabs-nav";

export default async function WebsiteLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const p = ctx.permissions;
  if (!(p.has("website.view") || p.has("enquiries.view"))) redirect("/forbidden");
  if (!ctx.tenant) redirect("/platform/clinics");
  const tabs = [
    ...(p.has("website.view") ? [{ href: "/website", label: "Overview" }] : []),
    ...(p.has("website.edit") ? [{ href: "/website/pages", label: "Pages" }] : []),
    ...(p.has("website.profile") ? [{ href: "/website/doctor-profile", label: "Doctor profile" }] : []),
    ...(p.has("website.edit") ? [{ href: "/website/services", label: "Services" }, { href: "/website/doctors", label: "Doctors" }, { href: "/website/testimonials", label: "Testimonials" }, { href: "/website/faq", label: "FAQ" }] : []),
    ...(p.has("website.edit") || p.has("website.articles") ? [{ href: "/website/articles", label: "Articles" }] : []),
    ...(p.has("website.edit") ? [{ href: "/website/navigation", label: "Navigation" }, { href: "/website/seo", label: "SEO" }] : []),
    ...(p.has("clinic.view") ? [{ href: "/settings/branding", label: "Branding" }] : []),
    ...(p.has("clinic.settings") ? [{ href: "/website/domain", label: "Domain" }] : []),
    ...(p.has("enquiries.view") ? [{ href: "/website/enquiries", label: "Enquiries" }] : []),
  ];
  return (
    <div className="space-y-section">
      <h1 className="type-page-title">Website</h1>
      <WebsiteTabs tabs={tabs} />
      {children}
    </div>
  );
}
