import { Megaphone } from "lucide-react";

/** Platform announcements for the signed-in clinic user. Audience was decided on the server. */
export function AnnouncementBanner({ items }: { items: { id: string; title: string; body: string }[] }) {
  if (!items.length) return null;
  return (
    <section aria-label="Announcements" className="mb-4 space-y-2">
      {items.map((a) => <div key={a.id} role="status" className="flex items-start gap-3 rounded-lg border border-info/30 bg-info-soft px-3 py-2.5"><Megaphone aria-hidden className="mt-0.5 size-5 shrink-0 text-info" /><p className="type-secondary min-w-0"><strong className="text-ink">{a.title}.</strong> {a.body}</p></div>)}
    </section>
  );
}
