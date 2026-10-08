import type { Metadata } from "next";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { requirePatientContext } from "@/lib/portal/ctx";
import { myCommunications } from "@/lib/services/portal-comms";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";
export default async function NotificationsPage() {
  const ctx = await requirePatientContext(); const sent = await myCommunications(ctx);
  return (
    <div className="space-y-6">
      <NotificationCenter api="/api/patient/notifications" portal settingsHref="/portal/settings" />
      <section aria-label="Messages the clinic sent you" className="rounded-2xl border border-line bg-surface">
        <div className="border-b border-line px-4 py-3"><h2 className="type-card-title">Messages the clinic sent you</h2><p className="type-caption">WhatsApp, SMS and email. They never contain medical results.</p></div>
        {sent.rows.length ? <ul className="divide-y divide-line">{sent.rows.map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><span className="type-label">{m.label}<span className="type-caption block">{m.channel} · {new Date(m.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></span><span className="type-caption">{m.status}</span></li>)}</ul> : <p className="type-secondary px-4 py-4">The clinic hasn&apos;t sent you any messages yet.</p>}
      </section>
    </div>
  );
}
