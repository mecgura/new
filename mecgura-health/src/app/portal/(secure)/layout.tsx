import { PortalShell } from "@/components/portal/portal-shell";
import { patientActor, unreadCount } from "@/lib/services/notifications";
import { portalLogoutAction } from "@/app/actions/portal";
import { requirePatientContext } from "@/lib/portal/ctx";

export const dynamic = "force-dynamic";
export default async function SecureLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePatientContext(); // not signed in as a patient -> /portal/login (never the staff login)
  const unread = (await unreadCount(patientActor(ctx))).unread;
  return <PortalShell clinic={{ name: ctx.tenant.name, logoUrl: ctx.tenant.logoUrl }} patientName={ctx.patient.name} unread={unread} logoutAction={portalLogoutAction}>{children}</PortalShell>;
}
