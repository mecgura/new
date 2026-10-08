import { redirect } from "next/navigation";
import { getPatientAccess } from "@/lib/portal/ctx";

export const dynamic = "force-dynamic";
export default async function PortalIndex() { const { ctx } = await getPatientAccess(); redirect(ctx ? "/portal/dashboard" : "/portal/login"); }
