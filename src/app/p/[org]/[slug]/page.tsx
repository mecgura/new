import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { publicPage } from "@/services/landing/pages";
import { PageView } from "@/components/landing/page-view";
import { ViewTracker } from "@/components/landing/interactive";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ org: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, slug } = await params;
  const p = await publicPage(org, slug);
  if (!p) return { title: "Page not found", robots: { index: false } };
  const hero = p.blocks.find((b) => b.type === "hero");
  const image = hero && hero.type === "hero" && hero.imageUrl ? hero.imageUrl : undefined;
  return {
    title: { absolute: `${p.seoTitle} | ${p.business}` },
    description: p.seoDescription || undefined,
    robots: p.noIndex ? { index: false, follow: false } : undefined,
    alternates: { canonical: p.url },
    openGraph: { title: p.seoTitle, description: p.seoDescription || undefined, url: p.url, siteName: p.business, type: "website", ...(image ? { images: [image] } : {}) },
  };
}

/** A client's published landing page. */
export default async function PublicLandingPage({ params }: Props) {
  const { org, slug } = await params;
  const p = await publicPage(org, slug);
  if (!p) notFound();
  const qr = p.blocks.some((b) => b.type === "qr") ? await QRCode.toDataURL(`${p.url}?utm_source=qr`, { width: 400, margin: 1 }) : undefined;
  return (
    <main>
      <ViewTracker pageId={p.id} />
      <PageView pageId={p.id} title={p.title} business={p.business} blocks={p.blocks} theme={p.theme} qrDataUrl={qr} />
    </main>
  );
}
