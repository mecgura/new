import type { Metadata } from "next";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { requireContext } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";
export default async function Page() { await requireContext(); return <NotificationCenter settingsHref="/notifications/settings" />; }
