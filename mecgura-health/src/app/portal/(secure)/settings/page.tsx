import type { Metadata } from "next";
import { PreferencesForm } from "@/components/portal/account-forms";
import { PageTitle } from "@/components/portal/portal-server";
import { requirePatientContext } from "@/lib/portal/ctx";
import { getPreferences } from "@/lib/services/portal-account";

export const metadata: Metadata = { title: "Communication preferences" };
export const dynamic = "force-dynamic";
export default async function SettingsPage() { const ctx = await requirePatientContext(); return <div><PageTitle title="Communication preferences" subtitle="Choose what you hear about and how." /><PreferencesForm initial={await getPreferences(ctx)} /></div>; }
