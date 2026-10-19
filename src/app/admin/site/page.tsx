import type { Metadata } from "next";
import { getHomeContent } from "@/services/site/home-content";
import { SiteEditor } from "@/components/admin/site-editor";

export const metadata: Metadata = { title: "Website" };
export const dynamic = "force-dynamic";

export default async function AdminSitePage() {
  return <SiteEditor initial={await getHomeContent()} />;
}
