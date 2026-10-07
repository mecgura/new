import type { Metadata } from "next";
import { AppShell } from "@/components/app/app-shell";
import { getAppContext } from "@/lib/app-context";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s | MECGURA" },
  robots: { index: false, follow: false },
};

export default async function ClientAppLayout({ children }: { children: React.ReactNode }) {
  const { shellUser, shellOrgs, active } = await getAppContext();
  return (
    <AppShell variant="client" user={shellUser} organizations={shellOrgs} activeOrganizationId={active?.organizationId ?? null}>
      {children}
    </AppShell>
  );
}
