import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/app-shell";
import { getAppContext } from "@/lib/app-context";
import { audit } from "@/lib/audit";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | MECGURA Admin" },
  description: "MECGURA Super Admin",
  robots: { index: false, follow: false },
};

// Server-side gate (the proxy is only a first filter): the DB role must be SUPER_ADMIN.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, shellUser, shellOrgs, active } = await getAppContext();
  if (user.platformRole !== "SUPER_ADMIN") {
    await audit({ action: "permission.denied", actorUserId: user.id, targetType: "admin", metadata: { area: "admin-ui" } });
    redirect("/dashboard?denied=admin");
  }
  return (
    <AppShell variant="admin" user={shellUser} organizations={shellOrgs} activeOrganizationId={active?.organizationId ?? null}>
      {children}
    </AppShell>
  );
}
