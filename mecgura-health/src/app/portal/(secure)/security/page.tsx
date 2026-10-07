import type { Metadata } from "next";
import { SecurityForms } from "@/components/portal/account-forms";
import { PageTitle } from "@/components/portal/portal-server";
import { requirePatientContext } from "@/lib/portal/ctx";
import { securityOverview } from "@/lib/services/portal-auth";

export const metadata: Metadata = { title: "Security" };
export const dynamic = "force-dynamic";
export default async function SecurityPage() { const ctx = await requirePatientContext(); return <div><PageTitle title="Account security" /><SecurityForms info={await securityOverview(ctx)} /></div>; }
