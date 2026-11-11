import type { Metadata } from "next";
import { MapPin, Phone, Mail } from "lucide-react";
import { ProfileSupportLink } from "@/components/portal/help-links";
import { PageTitle, Section } from "@/components/portal/portal-server";
import { requirePatientContext } from "@/lib/portal/ctx";
import { helpInfo } from "@/lib/services/portal-account";

export const metadata: Metadata = { title: "Need help?" };
export const dynamic = "force-dynamic";
export default async function HelpPage() {
  const ctx = await requirePatientContext(); const h = await helpInfo(ctx); const c = h.clinic;
  return (
    <div className="space-y-4">
      <PageTitle title="Need help?" subtitle={`Contact ${c.name}`} />
      <Section>
        <ul className="divide-y divide-line">
          {c.phone && <li><a href={`tel:${c.phone}`} className="flex min-h-14 items-center gap-3 px-4 py-3 no-underline hover:bg-surface-muted"><Phone aria-hidden className="size-5 !text-primary" /><span className="type-label !text-ink">{c.phone}</span></a></li>}
          {c.email && <li><a href={`mailto:${c.email}`} className="flex min-h-14 items-center gap-3 px-4 py-3 no-underline hover:bg-surface-muted"><Mail aria-hidden className="size-5 !text-primary" /><span className="type-label break-all !text-ink">{c.email}</span></a></li>}
          {c.address && <li className="flex min-h-14 items-center gap-3 px-4 py-3"><MapPin aria-hidden className="size-5 shrink-0 !text-primary" /><span className="type-label">{c.address}</span></li>}
          {!c.phone && !c.email && !c.address && <li className="px-4 py-6 text-center"><p className="type-secondary">The clinic hasn&apos;t added contact details yet.</p></li>}
        </ul>
      </Section>
      {h.note && <p className="type-secondary rounded-lg bg-surface-muted p-3">{h.note}</p>}
      <ProfileSupportLink />
    </div>
  );
}
