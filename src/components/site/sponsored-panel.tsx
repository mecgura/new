"use client";

import * as React from "react";

type Ad = { id: string; headline: string; body: string; ctaLabel: string; advertiser: string; imageUrl: string | null; href: string };

/** The labelled "Sponsored" side panel on mecgura.tech. Loads fresh ads on every visit, so cached pages still count views. */
export function SponsoredPanel({ advertiseHref }: { advertiseHref: string }) {
  const [ads, setAds] = React.useState<Ad[]>([]);
  React.useEffect(() => {
    let live = true;
    void fetch("/api/sponsored/serve", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { ads: [] }))
      .then((d: { ads?: Ad[] }) => live && setAds(Array.isArray(d.ads) ? d.ads : []))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!ads.length) return null;
  return (
    <aside aria-label="Sponsored" className="space-y-4">
      <p className="wa-muted text-caption font-semibold uppercase tracking-wide">Sponsored</p>
      {ads.map((a) => (
        <a key={a.id} href={a.href} target="_blank" rel="sponsored nofollow noopener" className="wa-card block overflow-hidden transition hover:shadow-md">
          {a.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.imageUrl} alt="" loading="lazy" className="aspect-[1.91/1] w-full object-cover" />
          ) : null}
          <div className="p-4">
            <p className="wa-muted text-caption">Sponsored · {a.advertiser}</p>
            <p className="mt-1 font-bold leading-snug">{a.headline}</p>
            {a.body ? <p className="wa-muted mt-1 text-small">{a.body}</p> : null}
            <span className="wa-btn wa-btn-ghost mt-3 !min-h-10 w-full text-small">{a.ctaLabel}</span>
          </div>
        </a>
      ))}
      <p className="wa-muted text-caption">
        <a href={advertiseHref} target="_blank" rel="noopener" className="hover:underline">Advertise here</a>
      </p>
    </aside>
  );
}
