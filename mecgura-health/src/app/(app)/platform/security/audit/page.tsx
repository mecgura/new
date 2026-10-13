import type { Metadata } from "next";
import { AuditTools } from "@/components/security/security-admin";
import { Card } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { getSecurityPolicy } from "@/lib/services/sec-policy";

export const metadata: Metadata = { title: "Audit integrity" };
export const dynamic = "force-dynamic";
export default async function Page() {
  await requirePagePermission("platform.manage"); const p = await getSecurityPolicy();
  return (<div className="space-y-section"><Card className="space-y-3 p-card"><h2 className="type-section-title">Tamper-evident audit trail</h2>
    <p className="type-secondary">Every audit record carries a signature made with a key kept outside the database, and the database refuses edits to audit rows. “Seal” pins a batch of records so a later deletion is detectable; “Verify” re-checks every recent record and every seal.</p>
    <p className="type-secondary">Retention: {p.auditRetentionDays ? `${p.auditRetentionDays} days (purge is manual, needs your password and a reason, and skips legal holds)` : "keep forever (no purge is possible until a retention period is set under Access & policy)."}</p>
    <AuditTools retentionDays={p.auditRetentionDays} /></Card></div>);
}
