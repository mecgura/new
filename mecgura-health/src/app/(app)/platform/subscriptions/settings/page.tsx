import type { Metadata } from "next";
import { PolicyForm, TaxForm, VendorForm } from "@/components/subscription/settings-forms";
import { when, label } from "@/components/subscription/format";
import { Alert, Card, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { providerStatus, webhookLog } from "@/lib/services/sub-admin";
import { billingSettings } from "@/lib/services/sub-config";

export const metadata: Metadata = { title: "Billing settings" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const ctx = await requirePagePermission("platform.manage"); const [s, log] = await Promise.all([billingSettings(ctx), webhookLog(ctx, 1)]); const p = providerStatus(ctx);
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Subscription billing settings</h1><p className="type-secondary mt-1">MECGURA&apos;s own legal, tax and support details, the payment provider, and the billing policy. Nothing is pre-filled.</p></div>
      <Card className="p-card space-y-2"><h2 className="type-section-title">Payment provider</h2>
        <p>Selected: <strong>{p.selected ?? "none"}</strong> · Credentials: <StatusBadge tone={p.configured ? "success" : "warning"}>{p.configured ? "present" : "missing"}</StatusBadge> · Webhook secret: <StatusBadge tone={p.webhookReady ? "success" : "warning"}>{p.webhookReady ? "present" : "missing"}</StatusBadge></p>
        <p className="type-secondary">{p.hint} Webhook URL to register at the provider: <code>/api/webhooks/subscriptions/{p.selected ?? "razorpay"}</code>. Recurring auto-debit is not used: renewals are invoices the clinic pays.</p></Card>
      {!s.vendorComplete && <Alert tone="warning" title="MECGURA details incomplete">Add the legal entity name and address below. Until then invoices show only the brand name — no legal details are invented.</Alert>}
      <Card className="p-card"><h2 className="type-section-title mb-3">MECGURA legal &amp; support details</h2><VendorForm vendor={s.vendor} /></Card>
      <Card className="p-card"><h2 className="type-section-title mb-3">Tax</h2><TaxForm tax={s.tax} /></Card>
      <Card className="p-card"><h2 className="type-section-title mb-3">Policy</h2><PolicyForm policy={s.policy} /></Card>
      <Card><div className="p-card pb-0"><h2 className="type-section-title">Recent webhook events</h2></div><div className="relative overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Webhook events</caption><thead><tr className="type-caption border-b border-line bg-surface-muted"><th scope="col" className="p-3">Received</th><th scope="col" className="p-3">Provider</th><th scope="col" className="p-3">Type</th><th scope="col" className="p-3">Status</th></tr></thead><tbody>{log.rows.map((e) => <tr key={e.id} className="border-b border-line last:border-0"><td className="p-3">{when(e.receivedAt, "Asia/Kolkata", true)}</td><td className="p-3">{e.provider}</td><td className="p-3">{e.eventType}</td><td className="p-3">{label(e.status)}{e.error ? ` — ${e.error}` : ""}</td></tr>)}</tbody></table>{!log.rows.length && <p className="type-secondary p-6 text-center">No webhook events yet.</p>}</div></Card>
    </div>
  );
}
