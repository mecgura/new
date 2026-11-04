import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { PublicShell } from "@/components/site/public-shell";
import { countView, getPublished, listPublished, tagList } from "@/services/site/blog";
import { readingMinutes, renderMarkdown } from "@/lib/markdown";
import { siteConfig } from "@/config/site";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getPublished((await params).slug).catch(() => null);
  if (!p) return { title: "Article not found", robots: { index: false } };
  const url = `${siteConfig.url}/blog/${p.slug}`;
  return {
    title: p.title,
    description: p.excerpt,
    alternates: { canonical: `/blog/${p.slug}` },
    robots: { index: true, follow: true },
    keywords: tagList(p.tags),
    authors: [{ name: p.author }],
    openGraph: { type: "article", url, title: p.title, description: p.excerpt, siteName: "MECGURA", publishedTime: p.publishedAt?.toISOString(), modifiedTime: p.updatedAt.toISOString(), tags: tagList(p.tags), ...(p.coverUrl ? { images: [{ url: p.coverUrl }] } : {}) },
    twitter: { card: p.coverUrl ? "summary_large_image" : "summary", title: p.title, description: p.excerpt },
  };
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

export default async function BlogPost({ params }: Props) {
  const p = await getPublished((await params).slug);
  if (!p) notFound();
  after(() => countView(p.id));
  const { html, headings } = renderMarkdown(p.body);
  const url = `${siteConfig.url}/blog/${p.slug}`;
  const more = (await listPublished(6)).filter((x) => x.id !== p.id).slice(0, 3);
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: p.title,
      description: p.excerpt,
      datePublished: p.publishedAt?.toISOString(),
      dateModified: p.updatedAt.toISOString(),
      author: { "@type": "Organization", name: p.author },
      publisher: { "@type": "Organization", name: "MECGURA", url: siteConfig.url },
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      keywords: tagList(p.tags).join(", "),
      ...(p.coverUrl ? { image: p.coverUrl.startsWith("/") ? `${siteConfig.url}${p.coverUrl}` : p.coverUrl } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: siteConfig.url },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${siteConfig.url}/blog` },
        { "@type": "ListItem", position: 3, name: p.title, item: url },
      ],
    },
  ];
  const wa = `https://wa.me/${siteConfig.contact.whatsapp}?text=${encodeURIComponent(`Hi MECGURA, I read "${p.title}" and want to know more.`)}`;
  return (
    <PublicShell>
      {/* JSON-LD: data we build ourselves; "<" is escaped so the content can't close the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <article className="mx-auto max-w-3xl px-4 py-10">
        <nav aria-label="Breadcrumb" className="wa-muted text-small"><Link href="/" className="hover:underline">Home</Link> › <Link href="/blog" className="hover:underline">Blog</Link></nav>
        <h1 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">{p.title}</h1>
        <p className="wa-muted mt-3 text-small">{p.author} · {p.publishedAt ? <time dateTime={p.publishedAt.toISOString()}>{dateFmt.format(p.publishedAt)}</time> : null} · {readingMinutes(p.body)} min read</p>
        {headings.filter((h) => h.level === 2).length >= 3 ? (
          <nav aria-label="On this page" className="wa-card mt-6 p-4 text-small">
            <p className="font-semibold">On this page</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">{headings.filter((h) => h.level === 2).map((h) => <li key={h.id}><a href={`#${h.id}`} className="hover:underline">{h.text}</a></li>)}</ol>
          </nav>
        ) : null}
        {/* renderMarkdown escapes all text and only emits its own tags. */}
        <div className="blog-prose mt-8" dangerouslySetInnerHTML={{ __html: html }} />
        <aside className="wa-card mt-10 p-6">
          <p className="text-lg font-bold">Want this set up for your business?</p>
          <p className="wa-muted mt-1 text-small">MECGURA sets up WhatsApp inbox, campaigns, automations and an AI assistant for Indian businesses — with plans from the pricing section on our homepage.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={wa} className="wa-btn !min-h-11 text-small">Talk on WhatsApp</a>
            <Link href="/#pricing" className="wa-btn wa-btn-ghost !min-h-11 text-small">See pricing</Link>
          </div>
        </aside>
        {more.length ? (
          <section className="mt-12">
            <h2 className="text-xl font-bold">More articles</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-3">
              {more.map((m) => (
                <li key={m.id} className="wa-card p-4"><Link href={`/blog/${m.slug}`} className="text-small font-semibold hover:underline">{m.title}</Link></li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </PublicShell>
  );
}
