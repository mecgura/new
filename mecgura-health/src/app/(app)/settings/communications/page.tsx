import type { Metadata } from "next";
import { CommsSettingsForm } from "@/components/communications/comms-settings-form";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Communication settings" };
export const dynamic = "force-dynamic";
export default async function Page() { await requireTenantPagePermission("communications.configure"); return <CommsSettingsForm />; }
