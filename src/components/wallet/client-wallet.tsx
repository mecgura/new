"use client";

import * as React from "react";
import { Alert, Button, Card, CardBody, Input } from "@/components/ds";
import { siteConfig } from "@/config/site";
import { WalletBalance, WalletFees, WalletLedger, WalletLoading, useWallet } from "@/components/wallet/wallet-parts";

/** The client's own wallet: balance and history. Credit is added by MECGURA after payment is received. */
export function ClientWallet({ orgId, canTopUp = false, onTopUp, busy = false }: { orgId: string; canTopUp?: boolean; onTopUp?: (rupees: number) => void; busy?: boolean }) {
  const [amount, setAmount] = React.useState("1000");
  const { data, error, load, setPage } = useWallet(`/api/organizations/${orgId}/wallet`);
  if (!data) return <WalletLoading error={error} onRetry={load} />;
  const { email, whatsapp } = siteConfig.contact;
  return (
    <div className="space-y-4">
      <WalletBalance wallet={data.wallet} />
      {canTopUp && onTopUp ? (
        <Card>
          <CardBody>
            <p className="font-semibold text-app-text">Add credit online</p>
            <p className="mt-1 text-small text-app-muted">Pay by UPI, card or net banking. Credit is added as soon as the payment is confirmed. GST, if applicable, is added on the invoice and is not part of the credit.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {[500, 1000, 2000, 5000].map((v) => (
                <Button key={v} size="sm" variant={amount === String(v) ? "primary" : "secondary"} onClick={() => setAmount(String(v))}>
                  ₹{v.toLocaleString("en-IN")}
                </Button>
              ))}
              <Input aria-label="Amount in rupees" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="h-9 w-28" />
              <Button loading={busy} disabled={!Number(amount)} onClick={() => onTopUp(Number(amount))}>
                Add money
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
      <Alert tone="info" title="About your wallet">
        The wallet holds prepaid MECGURA service credit. WhatsApp message charges made by Meta are billed by Meta to the payment method on your own WhatsApp Business account.
        {canTopUp ? "You can add credit online above, or pay MECGURA directly and it will be added here" : "To add credit, pay MECGURA and it will be added here"}
        {email || whatsapp ? (
          <>
            {" "}
            (contact {email ? <a className="underline" href={`mailto:${email}`}>{email}</a> : null}
            {email && whatsapp ? " or " : null}
            {whatsapp ? <a className="underline" href={`https://wa.me/${whatsapp}`}>WhatsApp +{whatsapp}</a> : null})
          </>
        ) : null}
        .
      </Alert>
      <WalletFees prices={data.prices} />
      <WalletLedger data={data} onPage={setPage} />
    </div>
  );
}
