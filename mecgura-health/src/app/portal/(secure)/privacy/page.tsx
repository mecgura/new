import type { Metadata } from "next";
import { ConsentsView } from "@/components/portal/account-forms";
import { PageTitle } from "@/components/portal/portal-server";
import { DataRightsCard } from "@/components/security/security-admin";
import { RIGHTS_KINDS } from "@/lib/services/sec-privacy";
import { requirePatientContext } from "@/lib/portal/ctx";
import { getConsents } from "@/lib/services/portal-account";

export const metadata: Metadata = { title: "Privacy and consent" };
export const dynamic = "force-dynamic";
export default async function PrivacyPage() { const ctx = await requirePatientContext(); return <div><PageTitle title="Privacy and consent" /><ConsentsView initial={await getConsents(ctx)} clinicName={ctx.tenant.name} /><div className="mt-6"><DataRightsCard kinds={Object.entries(RIGHTS_KINDS).map(([value, label]) => ({ value, label }))} /></div></div>; }
