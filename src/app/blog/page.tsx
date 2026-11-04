import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/site/public-shell";
import { listPublished, tagList } from "@/services/site/blog";
import { readingMinutes } from "@/lib/markdown";
import { siteConfig } from "@/config/site";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Blog: WhatsApp marketing, automation and AI for Indian businesses",
  description: "Practical guides on WhatsApp Business API, pricing, automation, chatbots and getting more customers — written for small and growing businesses in India.",
  alternates: { canonical: "/blog" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}/blog`, title: "MECGURA Blog", description: "Practical WhatsApp marketing and automation guides for Indian businesses.", siteName: "MECGURA" },
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export default async function BlogIndex() {
  const posts = await listPublished();
  return (
    <PublicShell>
      <section className="mx-auto max-w-5xl px-4 py-12">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">MECGURA Blog</h1>
        <p className="wa-muted mt-3 max-w-2xl">Practical guides on WhatsApp Business, automation, AI chatbots and getting more customers — for small and growing businesses in India.</p>
        {!posts.length ? (
          <p className="wa-muted mt-10">New articles are on the way.</p>
        ) : (
          <ul className="mt-10 grid gap-5 md:grid-cols-2">
            {posts.map((p) => (
              <li key={p.id} className="wa-card flex flex-col p-6">
                <p className="wa-muted text-caption">{p.publishedAt ? dateFmt.format(p.publishedAt) : ""} · {readingMinutes(p.body)} min read</p>
                <h2 className="mt-2 text-lg font-bold leading-snug"><Link href={`/blog/${p.slug}`} className="hover:underline">{p.title}</Link></h2>
                <p className="wa-muted mt-2 flex-1 text-small">{p.excerpt}</p>
                {tagList(p.tags).length ? <p className="mt-3 flex flex-wrap gap-1.5">{tagList(p.tags).map((t) => <span key={t} className="wa-pill text-caption">{t}</span>)}</p> : null}
                <Link href={`/blog/${p.slug}`} className="mt-4 text-small font-semibold text-[#128c7e] hover:underline">Read article →</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PublicShell>
  );
}
