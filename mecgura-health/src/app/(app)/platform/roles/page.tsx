import type { Metadata } from "next";
import { DataTable, Section } from "@/components/analytics/widgets";
import { Alert, Badge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { rolesOverview } from "@/lib/services/platform-admin";

export const metadata: Metadata = { title: "Roles & permissions" };
export const dynamic = "force-dynamic";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export default async function RolesPage() {
  const ctx = await requirePagePermission("platform.manage"); const r = rolesOverview(ctx);
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Roles & permissions</h1><p className="type-secondary mt-1">How access is defined today. Roles live in code and are read-only here so an identifier can never be renamed or weakened by accident.</p></div>
      <Alert tone="info" title="Built-in protections"><ul className="list-disc space-y-1 pl-5">{r.protections.map((p) => <li key={p}>{p}</li>)}</ul></Alert>
      <Section title="Permissions per role" description="Number of permissions each role holds, by area."><DataTable caption="Permissions per role" head={[{ label: "Role" }, { label: "Total", right: true }, ...r.modules.map((m) => ({ label: cap(m), right: true }))]} rows={r.roles.map((x) => [<span key={x.key}>{x.label} {x.assignable ? null : <Badge>not assignable</Badge>}</span>, x.permissionCount, ...r.modules.map((m) => x.byModule[m] || "·")])} /></Section>
      <Section title="All permissions" description={`${r.permissions.length} permissions. “Role only” permissions can never be granted individually (${r.nonGrantable}).`}>
        {r.modules.map((m) => <details key={m} className="border-b border-line py-2 last:border-0"><summary className="type-label cursor-pointer">{cap(m)} <span className="type-caption">({r.permissions.filter((p) => p.module === m).length})</span></summary><ul className="mt-2 space-y-1">{r.permissions.filter((p) => p.module === m).map((p) => <li key={p.key} className="type-secondary"><code className="text-xs">{p.key}</code> — {p.description} <Badge tone={p.grantable ? "info" : "neutral"}>{p.grantable ? "grantable" : "role only"}</Badge> <span className="type-caption">{p.roles.map((x) => x.toLowerCase().replace(/_/g, " ")).join(", ") || "no role"}</span></li>)}</ul></details>)}
      </Section>
    </div>
  );
}
