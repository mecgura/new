import type { Metadata } from "next";
import { getHomeContent } from "@/services/site/home-content";
import { SiteEditor } from "@/components/admin/site-editor";
import { HeroEditor } from "@/components/admin/hero-editor";

export const metadata: Metadata = { title: "Website" };
export const dynamic = "force-dynamic";

export default async function AdminSitePage() {
  const initial = await getHomeContent();
  return <SiteEditor initial={initial} top={<HeroEditor />} />;
}
