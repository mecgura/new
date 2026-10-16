import type { Metadata } from "next";
import { AnnouncementForm, AnnouncementToggle, DefaultsForm } from "@/components/platform/forms";
import { SensitiveAction } from "@/components/platform/sensitive-action";
import { Section } from "@/components/analytics/widgets";
import { StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { listAnnouncements, platformSettings } from "@/lib/services/platform-admin";
import { LegalForm } from "@/components/platform/legal-form";
import { getLegal } from "@/lib/services/legal";

export const metadata: Metadata = { title: "Platform settings" };
export const dynamic = "force-dynamic";
export default async function PlatformSettingsPage() {
  const ctx = await requirePagePermission("platform.manage");
  const [terms, privacy] = await Promise.all([getLegal("terms"), getLegal("privacy")]);
  const [s, ann, clinics] = await Promise.all([platformSettings(ctx), listAnnouncements(ctx), db.tenant.findMany({ where: { deletedAt: null, status: { not: "ARCHIVED" } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 })]);
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Platform settings</h1><p className="type-secondary mt-1">{s.hierarchy}</p></div>
      <Section title="Defaults" description="Used where a clinic has not set its own value. A clinic's own setting always wins."><DefaultsForm value={s.defaults} /></Section>
      <Section title="Maintenance mode" description="Blocks every clinic user and patient with a maintenance page. Super Admins are never blocked." action={<StatusBadge tone={s.maintenance.enabled ? "warning" : "neutral"}>{s.maintenance.enabled ? "On" : "Off"}</StatusBadge>}>
        <SensitiveAction label={s.maintenance.enabled ? "Turn maintenance off" : "Turn on platform maintenance"} variant={s.maintenance.enabled ? "primary" : "outline"} tone={s.maintenance.enabled ? "primary" : "danger"} size="md" title={s.maintenance.enabled ? "End platform maintenance?" : "Put the whole platform into maintenance?"} target="All clinics" impact={s.maintenance.enabled ? "Clinic users and patients can sign in again." : "Every clinic's staff and every patient is blocked with a maintenance message until you turn it off. You keep access. No data is changed."} endpoint="/api/platform/maintenance" body={{ enabled: !s.maintenance.enabled }} fields={s.maintenance.enabled ? [] : [{ name: "message", label: "Message shown to users", kind: "textarea", defaultValue: s.maintenance.message }]} successMessage="Maintenance mode updated" />
      </Section>
      <Section title="Announcements" description="Shown as a banner to signed-in clinic staff. This is not a marketing tool.">
        <AnnouncementForm clinics={clinics} />
        <ul className="mt-4 divide-y divide-line">{ann.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div className="min-w-0"><p className="type-label">{a.title}</p><p className="type-caption">{a.audience === "ALL" ? "All staff" : a.audience === "ADMINS" ? "Clinic admins" : `${a.audienceTenants.length} selected clinic(s)`}{a.endsAt ? ` · until ${a.endsAt.toLocaleString("en-IN")}` : ""}</p></div><AnnouncementToggle id={a.id} title={a.title} body={a.body} audience={a.audience} tenants={a.audienceTenants} active={a.active} /></li>)}{!ann.length && <li className="type-secondary py-3">No announcements yet.</li>}</ul>
      </Section>
      <Section title="Legal pages" description="Public Terms of Service and Privacy Policy, linked from the sign-in pages. Until you publish your own reviewed text, visitors see a clearly labelled draft outline. Have your legal counsel review the text."><div className="space-y-6"><LegalForm kind="terms" title="Terms of Service" initial={terms.text} draft={terms.draft} /><LegalForm kind="privacy" title="Privacy Policy" initial={privacy.text} draft={privacy.draft} /></div></Section>
      <Section title="Security posture" description="What the platform enforces today. These are fixed, tested behaviours — not switches."><ul className="divide-y divide-line">{s.security.map((x) => <li key={x.label} className="flex flex-wrap justify-between gap-2 py-2 type-secondary"><span>{x.label}</span><span className="text-right">{x.value}</span></li>)}</ul></Section>
    </div>
  );
}
