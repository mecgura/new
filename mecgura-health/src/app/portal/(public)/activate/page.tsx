import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicFrame } from "@/components/portal/public-frame";
import { getPatientAccess } from "@/lib/portal/ctx";
import { portalPublicTenant } from "@/lib/portal/public-tenant";
import { ActivateForm } from "./activate-form";

export const metadata: Metadata = { title: "Activate your account" };
export const dynamic = "force-dynamic";
export default async function ActivatePage({ searchParams }: { searchParams: Promise<{ clinic?: string }> }) {
  const sp = await searchParams; const { ctx } = await getPatientAccess(); if (ctx) redirect("/portal/dashboard");
  const tenant = await portalPublicTenant(sp.clinic);
  return (
    <PublicFrame tenant={tenant} title="Activate your account" subtitle="Ask the clinic reception for an activation code. It is valid for 3 days and works once.">
      <ActivateForm clinic={tenant?.slug ?? sp.clinic ?? ""} needsClinic={!tenant?.fromHost && !tenant} />
    </PublicFrame>
  );
}
