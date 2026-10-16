import type { Metadata, Viewport } from "next";
import { getPatientAccess } from "@/lib/portal/ctx";
import { resolvePublicTenant } from "@/lib/tenant/resolve";

/** The patient portal is private: never indexed, titled and iconised with the clinic's own name and favicon. */
export async function generateMetadata(): Promise<Metadata> {
  const { ctx } = await getPatientAccess();
  const pub = ctx ? null : await resolvePublicTenant();
  const name = ctx?.tenant.name ?? pub?.name ?? "Patient portal"; const icon = ctx?.tenant.faviconUrl ?? pub?.faviconUrl ?? undefined;
  return { title: { default: `Patient portal · ${name}`, template: `%s · ${name}` }, robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true }, ...(icon ? { icons: { icon } } : {}) };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function PortalRoot({ children }: { children: React.ReactNode }) { return children; }
