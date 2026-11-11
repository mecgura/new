import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, ClipboardList, HelpCircle, ListOrdered, Lock, ShieldCheck, UserRound } from "lucide-react";
import { PageTitle, Section } from "@/components/portal/portal-server";
import { requirePatientContext } from "@/lib/portal/ctx";

export const metadata: Metadata = { title: "More" };
export const dynamic = "force-dynamic";
const ITEMS = [["/portal/follow-ups", "Follow-ups", ClipboardList], ["/portal/opd", "Today's queue token", ListOrdered], ["/portal/profile", "My profile", UserRound], ["/portal/settings", "Communication preferences", BellRing], ["/portal/privacy", "Privacy and consent", ShieldCheck], ["/portal/security", "Account security", Lock], ["/portal/help", "Need help?", HelpCircle]] as const;
export default async function MorePage() {
  await requirePatientContext();
  return <div><PageTitle title="More" /><Section><ul className="divide-y divide-line">{ITEMS.map(([href, t, Icon]) => <li key={href}><Link href={href} className="flex min-h-14 items-center gap-4 px-4 py-3 no-underline hover:bg-surface-muted"><Icon aria-hidden className="size-5 shrink-0 !text-primary" /><span className="type-label !text-ink">{t}</span></Link></li>)}</ul></Section></div>;
}
