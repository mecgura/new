"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import type { ApiFailure } from "@/lib/errors";

type Envelope<T> = T & { notModified?: boolean; etag?: string };

/**
 * Honest "live" updates: plain polling. Pauses while the tab is hidden, backs off after errors, and sends the last ETag
 * so an unchanged queue costs one tiny response. (No websockets, no fake real-time.)
 */
export function usePolling<T>(url: string, opts: { intervalMs?: number; enabled?: boolean } = {}) {
  const { intervalMs = 5000, enabled = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFailure["error"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const etag = useRef<string>("");
  const fails = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const inflight = useRef(0);

  const load = useCallback(async (force = false) => {
    const seq = ++inflight.current;
    const sep = url.includes("?") ? "&" : "?";
    const res = await apiFetch<Envelope<T>>(`${url}${!force && etag.current ? `${sep}etag=${etag.current}` : ""}`);
    if (!alive.current || seq !== inflight.current) return;
    setLoading(false);
    if (!res.ok) { fails.current++; setError(res.error); return; }
    fails.current = 0; setError(null); setUpdatedAt(new Date());
    if (res.data.notModified) return;
    if (res.data.etag) etag.current = res.data.etag;
    setData(res.data as T);
  }, [url]);

  useEffect(() => {
    alive.current = true;
    etag.current = "";
    if (!enabled) return;
    const tick = async () => {
      if (!document.hidden) await load();
      if (!alive.current) return;
      const delay = Math.min(60_000, intervalMs * 2 ** Math.min(fails.current, 4));
      timer.current = setTimeout(tick, delay);
    };
    void tick();
    const onVisible = () => { if (!document.hidden) { if (timer.current) clearTimeout(timer.current); void tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, intervalMs, enabled]);

  const refresh = useCallback(() => load(true), [load]);
  return { data, error, loading, updatedAt, refresh };
}
