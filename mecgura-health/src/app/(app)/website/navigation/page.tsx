import type { Metadata } from "next";
import { NavigationEditor } from "@/components/website/section-editor";
import { requireTenantPagePermission } from "@/lib/auth/context";
import { getDraft } from "@/lib/services/website-content";

export const metadata: Metadata = { title: "Website navigation" };

export default async function NavigationPage() {
  const ctx = await requireTenantPagePermission("website.edit");
  const { draft } = await getDraft(ctx);
  return <NavigationEditor initial={draft.navigation} />;
}
