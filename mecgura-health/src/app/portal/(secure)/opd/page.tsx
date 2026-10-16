import type { Metadata } from "next";
import { OpdLive } from "@/components/portal/opd-live";
import { PageTitle } from "@/components/portal/portal-server";
import { requirePatientContext } from "@/lib/portal/ctx";
import { myOpd } from "@/lib/services/portal-records";

export const metadata: Metadata = { title: "Queue token" };
export const dynamic = "force-dynamic";
export default async function OpdPage() {
  const ctx = await requirePatientContext(); const initial = await myOpd(ctx);
  return <div><PageTitle title="Today's queue" subtitle="Only your own token is shown. Other patients' details are never displayed." /><OpdLive initial={initial} /></div>;
}
