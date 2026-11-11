import type { Metadata } from "next";
import Link from "next/link";
import { STATUS_TONE, when } from "@/components/subscription/format";
import { Card, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { securityOverview } from "@/lib/services/sec-center";
import { usingDerivedKey } from "@/lib/security/crypto";

export const metadata: Metadata = { title: "Security Center" };
export const dynamic = "force-dynamic";
const SEV_TONE = { INFO: "neutral", LOW: "info", MEDIUM: "warning", HIGH: "danger", CRITICAL: "danger" } as const;
const Tile = ({ k, v, note }: { k: string; v: string | number; note?: string }) => <Card className="p-card"><p className="type-caption">{k}</p><p className="text-2xl font-semibold">{v}</p>{note && <p className="type-caption mt-1">{note}</p>}</Card>;
export default async function Page() {
  const ctx = await requirePagePermission("platform.manage"); const o = await securityOverview(ctx);
  return (
    <div className="space-y-section">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile k="Open incidents" v={o.openIncidents} /><Tile k="Failed sign-ins (24 h)" v={o.failedLogins24h} note={`${o.lockedAccounts} account(s) locked now`} /><Tile k="High / critical (24 h)" v={o.last24h.HIGH + o.last24h.CRITICAL} note={`${o.last7d.HIGH + o.last7d.CRITICAL} in 7 days`} /><Tile k="Active support sessions" v={o.activeSupportSessions} />
        <Tile k="Super Admins with 2FA" v={`${o.mfaAdoption.superAdmins.withMfa} / ${o.mfaAdoption.superAdmins.total}`} /><Tile k="Clinic admins with 2FA" v={`${o.mfaAdoption.clinicAdmins.withMfa} / ${o.mfaAdoption.clinicAdmins.total}`} /><Tile k="Active API keys" v={o.apiKeys.active} note={`${o.apiKeys.expiringIn30d} expire within 30 days`} /><Tile k="Failed payment webhooks (7 d)" v={o.failedWebhooks7d} />
      </div>
      <Card className="space-y-2 p-card"><h2 className="type-section-title">Audit trail integrity</h2>
        <p>Last sealed up to: <strong>{o.audit.lastSealedTo ? when(o.audit.lastSealedTo, "Asia/Kolkata", true) : "never"}</strong> · Last verification: {o.audit.lastVerification ? <StatusBadge tone={o.audit.lastVerification.ok ? "success" : "danger"}>{o.audit.lastVerification.ok ? "passed" : "FAILED"} {when(o.audit.lastVerification.at, "Asia/Kolkata", true)}</StatusBadge> : "never run"} · <Link href="/platform/security/audit">Verify now</Link></p>
        {usingDerivedKey() && <p className="type-caption">Signing keys are derived from AUTH_SECRET. For production set SECURITY_KEYS so keys can be rotated independently.</p>}</Card>
      <Card><div className="p-card pb-0"><h2 className="type-section-title">Recent notable events</h2></div><div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Recent security events</caption><thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">When</th><th scope="col" className="p-3">Severity</th><th scope="col" className="p-3">Event</th><th scope="col" className="p-3">Address</th></tr></thead>
        <tbody>{o.recent.map((e) => <tr key={e.id} className="border-b border-line last:border-0"><td className="p-3">{when(e.at, "Asia/Kolkata", true)}</td><td className="p-3"><StatusBadge tone={SEV_TONE[e.severity as keyof typeof SEV_TONE] ?? STATUS_TONE.INACTIVE}>{e.severity.toLowerCase()}</StatusBadge></td><td className="p-3">{e.summary}<span className="type-caption block">{e.category.toLowerCase()} · {e.type}</span></td><td className="p-3">{e.ip ?? "—"}</td></tr>)}</tbody></table>
        {!o.recent.length && <p className="type-secondary p-6 text-center">No medium-or-higher events. Nothing suspicious has been detected.</p>}</div></Card>
      {o.topFailingIps.length > 0 && <Card className="p-card"><h2 className="type-section-title mb-2">Most failed sign-ins by address (24 h)</h2><ul className="space-y-1">{o.topFailingIps.map((t) => <li key={t.ip}>{t.ip} — {t.failures}</li>)}</ul></Card>}
    </div>
  );
}
