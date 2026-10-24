"use client";

import * as React from "react";
import { ArrowDownLeft, ArrowUpRight, Wallet as WalletIcon } from "lucide-react";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState, Pagination, Table, TBody, TD, TH, THead, TR } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatINR } from "@/lib/catalog";

export type WalletView = { balance: number; currency: string; lowBalanceThreshold: number; low: boolean };
export type WalletEntry = { id: string; direction: "credit" | "debit"; amount: number; balanceAfter: number; reason: string; note: string; reference: string; createdAt: string; createdBy: string | null };
export type WalletData = { wallet: WalletView; prices?: Record<"marketing" | "utility" | "authentication" | "service", number>; billingMode?: "client_pays" | "prepaid_wallet"; entries: WalletEntry[]; total: number; page: number; pageSize: number };

const dateTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const REASONS: Record<string, string> = { topup: "Credit added", correction: "Correction", usage: "Message usage", refund: "Refund" };

/** Loads one page of a wallet and its ledger from `url` (admin or client endpoint). */
export function useWallet(url: string) {
  const [data, setData] = React.useState<WalletData | null>(null);
  const [error, setError] = React.useState("");
  const [page, setPage] = React.useState(1);
  const load = React.useCallback(async () => {
    const r = await apiFetch<WalletData>(`${url}?page=${page}&pageSize=20`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [url, page]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  return { data, error, load, page, setPage };
}

export function WalletBalance({ wallet }: { wallet: WalletView }) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-4">
          <span className="grid size-12 place-items-center rounded-xl bg-app-primary/10 text-app-primary">
            <WalletIcon className="size-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-small text-app-muted">Wallet balance</p>
            <p className="font-display text-3xl font-bold text-app-text" data-testid="wallet-balance">
              {formatINR(wallet.balance)}
            </p>
          </div>
          {wallet.low ? <Badge tone="warning">Low balance</Badge> : null}
        </div>
        {wallet.low ? (
          <Alert tone="warning" className="mt-4">
            Balance is at or below the alert level of {formatINR(wallet.lowBalanceThreshold)}.
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}

const FEE_ROWS: [keyof NonNullable<WalletData["prices"]>, string][] = [
  ["marketing", "Marketing template"],
  ["utility", "Utility template"],
  ["authentication", "Authentication (OTP) template"],
  ["service", "Service reply (inside the 24-hour window)"],
];

/** MECGURA's per-message fee for this client (read-only). Free rows are shown as "Free". */
export function WalletFees({ prices }: { prices: WalletData["prices"] }) {
  if (!prices) return null;
  return (
    <Card>
      <CardHeader title="Message fees" description="What MECGURA takes from your wallet for each message sent. Meta's own charges are separate." />
      <Table caption="Message fees">
        <THead>
          <tr>
            <TH>Message type</TH>
            <TH className="text-right">MECGURA fee</TH>
          </tr>
        </THead>
        <TBody>
          {FEE_ROWS.map(([key, label]) => (
            <TR key={key}>
              <TD>{label}</TD>
              <TD className="text-right">{prices[key] ? `${formatINR(prices[key])} / message` : "Free"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

export function WalletLedger({ data, onPage }: { data: WalletData; onPage: (p: number) => void }) {
  return (
    <Card>
      <CardHeader title="Wallet history" description="Every credit and deduction, newest first." />
      {data.entries.length === 0 ? (
        <EmptyState icon={WalletIcon} title="No wallet activity yet" description="Credits and deductions will appear here." />
      ) : (
        <>
          <Table caption="Wallet ledger">
            <THead>
              <tr>
                <TH>When</TH>
                <TH>What</TH>
                <TH>Reference</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right">Balance</TH>
              </tr>
            </THead>
            <TBody>
              {data.entries.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap">{dateTime.format(new Date(e.createdAt))}</TD>
                  <TD>
                    <span className="flex items-center gap-1.5">
                      {e.direction === "credit" ? <ArrowDownLeft className="size-4 text-emerald-500" aria-hidden="true" /> : <ArrowUpRight className="size-4 text-red-500" aria-hidden="true" />}
                      {REASONS[e.reason] ?? e.reason}
                    </span>
                    {e.note ? <span className="block text-small text-app-muted">{e.note}</span> : null}
                  </TD>
                  <TD className="font-mono text-small">{e.reference || "—"}</TD>
                  <TD className={`text-right font-medium ${e.direction === "credit" ? "text-emerald-500" : "text-red-500"}`}>
                    {e.direction === "credit" ? "+" : "−"}
                    {formatINR(e.amount)}
                  </TD>
                  <TD className="text-right">{formatINR(e.balanceAfter)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={onPage} />
        </>
      )}
    </Card>
  );
}

export function WalletLoading({ error, onRetry }: { error: string; onRetry: () => void }) {
  return error ? <ErrorState description={error} onRetry={onRetry} /> : <LoadingState />;
}
