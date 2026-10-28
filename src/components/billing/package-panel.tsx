"use client";

import * as React from "react";
import { MessageSquareText, PackagePlus } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, LoadingState, UsageMeter, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatINR, formatNumber } from "@/lib/catalog";

export type BucketView = { included: number; used: number; credits: number; remaining: number; unlimited: boolean };
export type PackageView = { active: boolean; planName: string; month: string; resetsOn: string; marketing: BucketView; utility: BucketView };
type Pack = { id: string; bucket: "marketing" | "utility"; quantity: number; priceRupees: number };

const resetFmt = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** Allowance meters for one package (shared by client and admin views). */
export function PackageMeters({ pkg }: { pkg: PackageView }) {
  const row = (label: string, hint: string, b: BucketView) => (
    <div className="rounded-xl border border-app-border p-4">
      <UsageMeter label={label} used={b.used} limit={b.unlimited ? null : b.included} />
      <p className="mt-2 text-caption text-app-subtle">
        {hint}
        {b.credits ? <> · <span className="text-app-text">+{formatNumber(b.credits)} top-up left</span></> : null}
        {!b.unlimited ? <> · {formatNumber(Math.max(0, b.remaining))} can still be sent</> : null}
      </p>
    </div>
  );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {row("Marketing messages", "Offers, festival wishes, promotions", pkg.marketing)}
      {row("Utility messages", "Order updates, reminders, OTPs", pkg.utility)}
    </div>
  );
}

/** Client: this month's message package, and top-up packs paid from the wallet. */
export function PackagePanel({ orgId, canManage, onWallet }: { orgId: string; canManage: boolean; onWallet?: () => void }) {
  const toast = useToast();
  const url = `/api/organizations/${orgId}/package`;
  const [data, setData] = React.useState<{ package: PackageView; packs: Pack[]; walletBalance: number } | null>(null);
  const [busy, setBusy] = React.useState("");
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ package: PackageView; packs: Pack[]; walletBalance: number }>(url);
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
  }, [url, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function buy(p: Pack) {
    if (!window.confirm(`Buy ${formatNumber(p.quantity)} ${p.bucket} messages for ${formatINR(Math.round(p.priceRupees * 100))} from your wallet?`)) return;
    setBusy(p.id);
    const r = await apiFetch(`${url}/buy`, { method: "POST", body: { packId: p.id, key: crypto.randomUUID() } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    toast("Top-up added. You can send again.");
    void load();
  }

  if (!data) return <LoadingState />;
  if (!data.package.active) {
    return (
      <Card>
        <EmptyState icon={MessageSquareText} title="No message package" description="Your WhatsApp message charges are not part of a MECGURA package. Ask MECGURA about packages with messages included every month." />
      </Card>
    );
  }
  const pkg = data.package;
  const out = (["marketing", "utility"] as const).filter((b) => !pkg[b].unlimited && pkg[b].remaining <= 0);
  return (
    <div className="space-y-4">
      {out.length ? (
        <Alert tone="danger" title={`Your ${out.join(" and ")} messages are used up`}>
          Sending those messages is paused. Buy a top-up pack below, or the allowance resets on {resetFmt(pkg.resetsOn)}.
        </Alert>
      ) : null}
      <Card>
        <CardHeader title={`Message package${pkg.planName ? ` · ${pkg.planName}` : ""}`} description={`This month's allowance. Resets on ${resetFmt(pkg.resetsOn)}; unused messages don't carry forward. Replies within 24 hours of a customer's message are free and not counted.`} />
        <CardBody>
          <PackageMeters pkg={pkg} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Top-up packs" description={`Used after your monthly allowance and never expire. Paid from your wallet (balance ${formatINR(data.walletBalance)}).`} action={onWallet ? <Button size="sm" variant="secondary" onClick={onWallet}>Add money to wallet</Button> : null} />
        <CardBody>
          {data.packs.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.packs.map((p) => (
                <div key={p.id} className="flex flex-col rounded-xl border border-app-border p-4">
                  <Badge tone={p.bucket === "marketing" ? "primary" : "info"}>{p.bucket}</Badge>
                  <p className="mt-2 font-display text-2xl font-bold text-app-text">{formatNumber(p.quantity)}</p>
                  <p className="text-small text-app-muted">{p.bucket} messages</p>
                  <p className="mt-2 text-body font-semibold text-app-text">{formatINR(Math.round(p.priceRupees * 100))}</p>
                  {canManage ? (
                    <Button className="mt-3" size="sm" loading={busy === p.id} onClick={() => void buy(p)}>
                      <PackagePlus aria-hidden="true" /> Buy
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-small text-app-muted">No top-up packs are on sale right now. Ask MECGURA to add messages.</p>
          )}
          {!canManage ? <p className="mt-3 text-caption text-app-subtle">Only the workspace owner can buy top-ups.</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}
