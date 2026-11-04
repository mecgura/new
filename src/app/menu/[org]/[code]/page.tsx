import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicMenu } from "@/services/food/food";
import { GuestMenu } from "@/components/food/guest-menu";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ org: string; code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, code } = await params;
  const m = await publicMenu(org, code);
  return { title: m ? `${m.venue} · Menu` : "Menu", robots: { index: false, follow: false } };
}

/** Guest menu for one room/table (opened from its QR code). */
export default async function MenuPage({ params }: Props) {
  const { org, code } = await params;
  const m = await publicMenu(org, code);
  if (!m) notFound();
  return <GuestMenu org={org} menu={m} />;
}
