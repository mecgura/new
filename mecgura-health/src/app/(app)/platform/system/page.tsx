import type { Metadata } from "next";
import { CheckCircle2, CircleHelp, TriangleAlert, XCircle } from "lucide-react";
import { Section } from "@/components/analytics/widgets";
import { Alert, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { providerMonitor, systemHealth, webhookMonitor } from "@/lib/services/platform-monitor";

export const metadata: Metadata = { title: "System health" };
export const dynamic = "force-dynamic";
const ICON = { ok: <CheckCircle2 aria-hidden className="size-5 text-success" />, warn: <TriangleAlert aria-hidden className="size-5 text-warning" />, down: <XCircle aria-hidden className="size-5 text-danger" />, unknown: <CircleHelp aria-hidden className="size-5 text-muted" /> } as const;
const WORD = { ok: "OK", warn: "Needs attention", down: "Down", unknown: "Unknown" } as const;
const fmt = (d: Date | null) => (d ? d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Never");

export default async function SystemPage() {
  const ctx = await requirePagePermission("platform.manage"); const [h, providers, hooks] = await Promise.all([systemHealth(ctx), providerMonitor(ctx), webhookMonitor(ctx)]);
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">System health</h1><p className="type-secondary mt-1">Read from the running system. “Unknown” means nothing is recorded to answer with — it is never shown as healthy.</p></div>
      <Alert tone={h.overall === "ok" ? "success" : h.overall === "down" ? "danger" : "warning"} title={h.overall === "ok" ? "No problems detected" : h.overall === "down" ? "A component is down" : "Needs attention"}>Checked {new Date(h.generatedAt).toLocaleString("en-IN")}.</Alert>
      <Section title="Components"><ul className="divide-y divide-line">{h.components.map((c) => <li key={c.key} className="flex items-start gap-3 py-3">{ICON[c.status]}<div className="min-w-0 flex-1"><p className="type-label">{c.label} <StatusBadge tone={c.status === "ok" ? "success" : c.status === "warn" ? "warning" : c.status === "down" ? "danger" : "neutral"}>{WORD[c.status]}</StatusBadge></p><p className="type-secondary break-words">{c.detail}</p></div></li>)}</ul></Section>
      <Section title="Communication providers" description="Credentials are never shown — only whether a provider is configured."><div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Providers</caption><thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Channel</th><th scope="col" className="p-3">Provider</th><th scope="col" className="p-3">State</th><th scope="col" className="p-3">Last success</th><th scope="col" className="p-3">Last failure</th><th scope="col" className="p-3 text-right">Failures 7 d</th><th scope="col" className="p-3">Health</th></tr></thead>
        <tbody>{providers.map((p) => <tr key={p.channel} className="border-b border-line last:border-0 align-top"><td className="p-3 type-label">{p.channel}</td><td className="p-3 type-secondary">{p.provider ?? "—"}</td><td className="p-3"><StatusBadge tone={p.state === "CONFIGURED" ? "success" : p.state === "ERROR" ? "danger" : "neutral"}>{p.state === "CONFIGURED" ? "Configured ✓" : p.state === "ERROR" ? "Error" : "Not configured"}</StatusBadge></td><td className="p-3 type-secondary">{fmt(p.lastSuccessAt)}</td><td className="p-3 type-secondary">{fmt(p.lastFailureAt)}{p.lastFailureCode ? ` (${p.lastFailureCode})` : ""}</td><td className="p-3 text-right tabular-nums">{p.failures7d}</td><td className="p-3 type-secondary">{p.health}</td></tr>)}</tbody></table></div></Section>
      <Section title="Webhooks" description={hooks.note}><ul className="divide-y divide-line">{hooks.endpoints.map((e) => <li key={e.channel} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="type-label">{e.channel} <span className="type-caption">{e.provider ?? "no provider"}</span></span><span className="type-secondary">{e.verificationReady ? "Signature verification ready" : "Verification not set up"} · {e.events24h} event(s) in 24 h · {e.problems24h} unmatched · last {fmt(e.lastEventAt)}</span></li>)}</ul></Section>
    </div>
  );
}
