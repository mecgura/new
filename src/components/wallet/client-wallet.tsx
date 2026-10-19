"use client";

import { Alert } from "@/components/ds";
import { siteConfig } from "@/config/site";
import { WalletBalance, WalletFees, WalletLedger, WalletLoading, useWallet } from "@/components/wallet/wallet-parts";

/** The client's own wallet: balance and history. Credit is added by MECGURA after payment is received. */
export function ClientWallet({ orgId }: { orgId: string }) {
  const { data, error, load, setPage } = useWallet(`/api/organizations/${orgId}/wallet`);
  if (!data) return <WalletLoading error={error} onRetry={load} />;
  const { email, whatsapp } = siteConfig.contact;
  return (
    <div className="space-y-4">
      <WalletBalance wallet={data.wallet} />
      <Alert tone="info" title="About your wallet">
        The wallet holds prepaid MECGURA service credit. WhatsApp message charges made by Meta are billed by Meta to the payment method on your own WhatsApp Business account.
        To add credit, pay MECGURA and it will be added here
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
