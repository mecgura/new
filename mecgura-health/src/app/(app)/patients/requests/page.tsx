import type { Metadata } from "next";
import { PortalRequestsBoard } from "@/components/portal/portal-requests-board";
import { requireTenantPagePermission } from "@/lib/auth/context";

export const metadata: Metadata = { title: "Portal requests" };
export const dynamic = "force-dynamic";
export default async function Page() { await requireTenantPagePermission("portal.manage"); return <div className="space-y-section"><h1 className="type-page-title">Portal requests</h1><PortalRequestsBoard /></div>; }
