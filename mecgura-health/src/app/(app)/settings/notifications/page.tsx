import type { Metadata } from "next";
import { NotificationRules } from "@/components/notifications/notification-rules";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Notification rules" };
export const dynamic = "force-dynamic";
export default async function Page() { await requireTenantPagePermission("notifications.configure"); return <NotificationRules />; }
