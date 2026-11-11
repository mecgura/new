import type { Metadata } from "next";
import { NotificationPreferences } from "@/components/notifications/notification-preferences";
import { requireContext } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Notification settings" };
export const dynamic = "force-dynamic";
export default async function Page() { await requireContext(); return <NotificationPreferences />; }
