import type { Metadata } from "next";
import { NotificationsList } from "@/components/portal/account-forms";
import { PageTitle } from "@/components/portal/portal-server";
import { requirePatientContext } from "@/lib/portal/ctx";
import { listNotifications } from "@/lib/services/portal-account";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";
export default async function NotificationsPage() { const ctx = await requirePatientContext(); return <div><PageTitle title="Notifications" /><NotificationsList initial={await listNotifications(ctx)} /></div>; }
