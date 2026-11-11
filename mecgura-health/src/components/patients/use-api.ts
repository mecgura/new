"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { ApiFailure } from "@/lib/errors";

/** Load-on-demand data for one section of the patient file (so the profile page itself stays light). */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFailure["error"] | null>(null);
  const [loading, setLoading] = useState(!!url);
  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    const r = await apiFetch<T>(url);
    setLoading(false);
    if (r.ok) { setData(r.data); setError(null); } else setError(r.error);
  }, [url]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
