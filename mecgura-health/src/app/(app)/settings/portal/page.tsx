import type { Metadata } from "next";
import { PortalPolicyForm } from "@/components/portal/portal-policy-form";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Patient portal settings" };
export const dynamic = "force-dynamic";
export default async function Page() { await requireTenantPagePermission("portal.manage"); return <PortalPolicyForm />; }
