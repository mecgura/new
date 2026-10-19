import type { Metadata } from "next";
import { AppShell } from "@/components/app/app-shell";
import { getAppContext } from "@/lib/app-context";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s | MECGURA" },
  robots: { index: false, follow: false },
};

export default async function ClientAppLayout({ children }: { children: React.ReactNode }) {
  const { shellUser, shellOrgs, active } = await getAppContext();
  const enabledServices = active ? (await db.organizationService.findMany({ where: { organizationId: active.organizationId, enabled: true }, select: { service: true } })).map((s) => s.service) : [];
  return (
    <AppShell variant="client" user={shellUser} organizations={shellOrgs} activeOrganizationId={active?.organizationId ?? null} enabledServices={enabledServices}>
      {children}
    </AppShell>
  );
}
