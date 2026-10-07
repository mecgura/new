"use client";

import * as React from "react";
import { apiFetch } from "@/lib/client-api";

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number };

/** Loads a paginated admin list; debounced search; exposes reload for after mutations. */
export function usePaged<T>(endpoint: string, params: Record<string, string>, pageSize = 20) {
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<Paged<T> | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const key = JSON.stringify(params);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ ...JSON.parse(key), page: String(page), pageSize: String(pageSize) });
    const r = await apiFetch<Paged<T>>(`${endpoint}?${qs}`);
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setData(r.data);
  }, [endpoint, key, page, pageSize]);

  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);

  // Reset to page 1 when filters change.
  const [lastKey, setLastKey] = React.useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setPage(1);
  }

  return { data, error, loading, page, setPage, reload: load };
}
