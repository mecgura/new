"use client";

import * as React from "react";
import { apiFetch } from "@/lib/client-api";

export type Pricing = { meta: Record<string, number>; fees: Record<string, number> };

/** Per-message prices for a workspace (paise), loaded once per page. */
export function usePricing(orgId: string) {
  const [p, setP] = React.useState<Pricing | null>(null);
  React.useEffect(() => {
    void apiFetch<Pricing>(`/api/organizations/${orgId}/pricing`).then((r) => r.ok && setP(r.data));
  }, [orgId]);
  return p;
}

/** ₹ amount from paise, keeping paise precision for small per-message prices. */
export function rupees(paise: number) {
  const r = paise / 100;
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: r < 10 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function messageCost(p: Pricing | null, category: string, count = 1) {
  if (!p) return null;
  const c = category.toLowerCase();
  const meta = (p.meta[c] ?? 0) * count;
  const fee = (p.fees[c] ?? 0) * count;
  return { meta, fee, total: meta + fee };
}
