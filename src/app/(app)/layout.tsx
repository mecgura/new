import type { Metadata } from "next";
import { AppShell } from "@/components/app/app-shell";
import { getAppContext } from "@/lib/app-context";
import { db } from "@/lib/db";
import { activeFestival, getFestivals } from "@/services/site/festivals";
import { FestivalGreeting } from "@/components/festival/festival-banner";
import { CallDock } from "@/components/calls/call-dock";
import { hasFeature } from "@/services/billing/entitlements";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s | MECGURA" },
  robots: { index: false, follow: false },
};

export default async function ClientAppLayout({ children }: { children: React.ReactNode }) {
  const { user, shellUser, shellOrgs, active } = await getAppContext();
  const enabledServices = active ? (await db.organizationService.findMany({ where: { organizationId: active.organizationId, enabled: true }, select: { service: true } })).map((s) => s.service) : [];
  const festival = activeFestival(await getFestivals(), "clients");
  // The call dock only runs where WhatsApp calling is actually on (plan feature + a number with calling enabled).
  const callsOn = active ? (await hasFeature(active.organizationId, "calling")) && (await db.whatsAppAccount.count({ where: { organizationId: active.organizationId, callingEnabled: true, status: "connected" } })) > 0 : false;
  const orgName = shellOrgs.find((o) => o.id === active?.organizationId)?.name ?? "";
  return (
    <AppShell variant="client" user={shellUser} organizations={shellOrgs} activeOrganizationId={active?.organizationId ?? null} enabledServices={enabledServices}>
      {children}
      {callsOn && active ? <CallDock orgId={active.organizationId} /> : null}
      {festival ? <FestivalGreeting festival={{ ...festival, photoUrl: festival.hasPhoto ? `/api/festival-photo/${festival.id}` : null, endsLabel: "" }} orgName={orgName} userId={user.id} /> : null}
    </AppShell>
  );
}
