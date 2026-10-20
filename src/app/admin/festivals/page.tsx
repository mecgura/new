import type { Metadata } from "next";
import { getFestivals, istToday } from "@/services/site/festivals";
import { FestivalEditor } from "@/components/admin/festival-editor";

export const metadata: Metadata = { title: "Festivals" };
export const dynamic = "force-dynamic";

export default async function AdminFestivalsPage() {
  return <FestivalEditor initial={await getFestivals()} today={istToday()} />;
}
