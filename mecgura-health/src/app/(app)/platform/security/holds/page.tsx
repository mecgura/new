import type { Metadata } from "next";
import { HoldsManager } from "@/components/security/security-admin";
import { Card } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { listLegalHolds } from "@/lib/services/sec-audit";

export const metadata: Metadata = { title: "Legal holds" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const ctx = await requirePagePermission("platform.manage"); const [holds, tenants] = await Promise.all([listLegalHolds(ctx), db.tenant.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 })]);
  return <Card className="space-y-3 p-card"><h2 className="type-section-title">Legal holds</h2><HoldsManager holds={JSON.parse(JSON.stringify(holds))} platform tenantOptions={tenants.map((t) => ({ value: t.id, label: t.name }))} /></Card>;
}
