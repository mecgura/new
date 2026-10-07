import { PortalShell } from "@/components/portal/portal-shell";
import { portalLogoutAction } from "@/app/actions/portal";
import { requirePatientContext } from "@/lib/portal/ctx";
import { pdb } from "@/lib/services/portal-core";

export const dynamic = "force-dynamic";
export default async function SecureLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePatientContext(); // not signed in as a patient -> /portal/login (never the staff login)
  const unread = (await pdb(ctx).notification.count({ where: { userId: ctx.user.id, readAt: null } })) as number;
  return <PortalShell clinic={{ name: ctx.tenant.name, logoUrl: ctx.tenant.logoUrl }} patientName={ctx.patient.name} unread={unread} logoutAction={portalLogoutAction}>{children}</PortalShell>;
}
