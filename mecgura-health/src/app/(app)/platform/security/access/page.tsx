import type { Metadata } from "next";
import { when } from "@/components/subscription/format";
import { PolicyEditor } from "@/components/security/security-admin";
import { Card, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { accessReview } from "@/lib/services/sec-center";
import { getSecurityPolicy } from "@/lib/services/sec-policy";

export const metadata: Metadata = { title: "Access & policy" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const ctx = await requirePagePermission("platform.manage"); const [p, a] = await Promise.all([getSecurityPolicy(), accessReview(ctx)]);
  return (
    <div className="space-y-section">
      <Card className="space-y-3 p-card"><h2 className="type-section-title">Platform security policy</h2><PolicyEditor scope="platform" mfaRoles={p.mfaRequiredRoles} retentionDays={p.auditRetentionDays} /></Card>
      <Card><div className="p-card pb-0"><h2 className="type-section-title">Access review — privileged accounts</h2><p className="type-caption">Super Admins and Clinic Admins. Review who still needs this power.</p></div><div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Privileged accounts</caption><thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Person</th><th scope="col" className="p-3">Role</th><th scope="col" className="p-3">Clinic</th><th scope="col" className="p-3">2FA</th><th scope="col" className="p-3">Last sign-in</th></tr></thead>
        <tbody>{a.privileged.map((u) => <tr key={u.id} className="border-b border-line last:border-0"><th scope="row" className="p-3 text-left">{u.name}<span className="type-caption block">{u.email}</span></th><td className="p-3">{u.role.replace("_", " ").toLowerCase()}</td><td className="p-3">{u.clinic}</td><td className="p-3"><StatusBadge tone={u.mfa ? "success" : "warning"}>{u.mfa ? "on" : "off"}</StatusBadge></td><td className="p-3">{u.lastLoginAt ? when(u.lastLoginAt) : "never"} {u.inactive90d && <StatusBadge tone="warning">inactive 90 d+</StatusBadge>}</td></tr>)}</tbody></table></div></Card>
      <Card><div className="p-card pb-0"><h2 className="type-section-title">Users with extra permission grants</h2></div><div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Users with extra grants</caption><thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Person</th><th scope="col" className="p-3">Role</th><th scope="col" className="p-3">Clinic</th><th scope="col" className="p-3 text-right">Extra grants</th></tr></thead>
        <tbody>{a.withExtraGrants.map((u) => <tr key={u.id} className="border-b border-line last:border-0"><th scope="row" className="p-3 text-left">{u.name}</th><td className="p-3">{u.role.replace("_", " ").toLowerCase()}</td><td className="p-3">{u.clinic}</td><td className="p-3 text-right">{u.grants}</td></tr>)}</tbody></table>{!a.withExtraGrants.length && <p className="type-secondary p-6 text-center">No user has extra grants.</p>}</div></Card>
    </div>
  );
}
