import type { Metadata } from "next";
import { SectionEditor } from "@/components/website/section-editor";
import type { Values } from "@/components/website/fields";
import { Alert } from "@/components/ui";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { SEO_FIELDS } from "@/lib/website/cms-config";
import { getDraft } from "@/lib/services/website-content";

export const metadata: Metadata = { title: "Website SEO" };

export default async function SeoPage() {
  const ctx = await requireTenantPagePermission("website.edit");
  const { draft } = await getDraft(ctx);
  return (
    <div className="space-y-section">
      <Alert tone="info">Each service, doctor and article also has its own SEO title and description. Anything left blank is generated from your real content — never invented.</Alert>
      <SectionEditor section="seo" title="Search & sharing" fields={SEO_FIELDS} initial={draft.seo as unknown as Values} />
    </div>
  );
}
