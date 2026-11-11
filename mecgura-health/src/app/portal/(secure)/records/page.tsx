import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, FileText, FlaskConical, FolderOpen, History, Stethoscope } from "lucide-react";
import { PageTitle, Section } from "@/components/portal/portal-server";
import { requirePatientContext } from "@/lib/portal/ctx";

export const metadata: Metadata = { title: "My records" };
export const dynamic = "force-dynamic";
const ITEMS = [["/portal/prescriptions", "Prescriptions", "Your doctor's medicines", FileText], ["/portal/reports", "Lab reports", "Test results released to you", FlaskConical], ["/portal/consultations", "Consultations", "Summaries of your visits", Stethoscope], ["/portal/documents", "Documents", "Open, print or download", FolderOpen], ["/portal/timeline", "My timeline", "What has happened with your care", History], ["/portal/follow-ups", "Follow-ups", "Planned check-ups", ClipboardList]] as const;
export default async function RecordsPage() {
  await requirePatientContext();
  return <div><PageTitle title="My records" /><Section><ul className="divide-y divide-line">{ITEMS.map(([href, t, d, Icon]) => <li key={href}><Link href={href} className="flex min-h-16 items-center gap-4 px-4 py-3 no-underline hover:bg-surface-muted"><Icon aria-hidden className="size-6 shrink-0 !text-primary" /><span><span className="type-label block !text-ink">{t}</span><span className="type-secondary">{d}</span></span></Link></li>)}</ul></Section></div>;
}
