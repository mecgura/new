import type { Metadata } from "next";
import { ClinicSectionEditor, SectionEditor } from "@/components/website/section-editor";
import { PublishBar } from "@/components/website/publish-bar";
import { Tabs } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { ABOUT_FIELDS, CLINIC_FIELDS, CONTACT_FIELDS, FOOTER_FIELDS, HERO_FIELDS, HOME_FIELDS, LEGAL_FIELDS, PAGES_FIELDS } from "@/lib/website/cms-config";
import { getDraft } from "@/lib/services/website-content";
import { starterPrivacy, starterTerms } from "@/lib/website/starter-text";
import type { Values } from "@/components/website/fields";

export const metadata: Metadata = { title: "Website pages" };

export default async function PagesEditor({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const ctx = await requireTenantPagePermission("website.edit");
  const { section } = await searchParams;
  const { draft, website, hasUnpublishedChanges } = await getDraft(ctx);
  const clinicName = ctx.tenant.name;
  const v = (o: unknown) => o as Values;
  return (
    <div className="space-y-section">
      <PublishBar status={website.status as "DRAFT" | "PUBLISHED"} hasChanges={hasUnpublishedChanges} canPublish={ctx.permissions.has("website.publish")} />
      <Tabs label="Page sections" defaultKey={section} tabs={[
        { key: "home", label: "Home", content: <div className="space-y-section"><SectionEditor section="hero" title="Home page — hero" description="The first thing visitors see. Leave anything blank to hide it." fields={HERO_FIELDS} initial={v(draft.hero)} /><SectionEditor section="home" title="Home page — sections" fields={HOME_FIELDS} initial={v(draft.home)} /></div> },
        { key: "about", label: "About", content: <SectionEditor section="about" title="About page" description="Doctor-specific details (photo, qualifications) come from the doctor profile." fields={ABOUT_FIELDS} initial={v(draft.about)} /> },
        { key: "clinic", label: "Clinic & hours", content: <ClinicSectionEditor fields={CLINIC_FIELDS} initial={v(draft.clinic)} /> },
        { key: "contact", label: "Contact", content: <SectionEditor section="contact" title="Contact page" fields={CONTACT_FIELDS} initial={v(draft.contact)} /> },
        { key: "legal", label: "Privacy & terms", content: <SectionEditor section="legal" title="Privacy & terms" fields={LEGAL_FIELDS} initial={v(draft.legal)} starter={[{ field: "privacy", label: "Insert starter privacy text", text: starterPrivacy(clinicName) }, { field: "terms", label: "Insert starter terms text", text: starterTerms(clinicName) }]} /> },
        { key: "footer", label: "Footer", content: <SectionEditor section="footer" title="Footer" fields={FOOTER_FIELDS} initial={v(draft.footer)} /> },
        { key: "switches", label: "Page switches", content: <SectionEditor section="pages" title="Which pages exist" description="A page only appears when it is on AND has content." fields={PAGES_FIELDS} initial={v(draft.pages)} /> },
      ]} />
    </div>
  );
}
