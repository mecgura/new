import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageTitle, Section } from "@/components/portal/portal-server";
import { requirePatientContext } from "@/lib/portal/ctx";
import { myTimeline } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "My timeline" };
export const dynamic = "force-dynamic";
export default async function TimelinePage() {
  const ctx = await requirePatientContext(); const t = await myTimeline(ctx);
  return (
    <div>
      <PageTitle title="My timeline" subtitle="What has happened with your care, newest first." />
      <Section>{!t.events.length ? <Empty title="Nothing here yet" /> : (
        <ol className="relative m-4 space-y-5 border-l-2 border-line pl-5">{t.events.map((e) => (
          <li key={e.id} className="relative"><span aria-hidden className="absolute -left-[1.6rem] top-1.5 size-3 rounded-full border-2 border-surface bg-primary" />
            <p className="type-label">{e.href ? <Link href={e.href}>{e.title}</Link> : e.title}</p>{e.detail && <p className="type-secondary">{e.detail}</p>}<p className="type-caption"><time dateTime={e.at}>{new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: ctx.tenant.timezone })}</time></p></li>
        ))}</ol>
      )}</Section>
    </div>
  );
}
