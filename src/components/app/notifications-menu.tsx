"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, CheckCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dropdown, DropdownItem, ErrorState, LoadingState } from "@/components/ds";

type Item = { id: string; type: string; title: string; body: string; link: string; readAt: string | null; createdAt: string };

function timeAgo(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationsMenu() {
  const router = useRouter();
  const [items, setItems] = React.useState<Item[] | null>(null);
  const [unread, setUnread] = React.useState(0);
  const [error, setError] = React.useState(false);

  const load = React.useCallback(async () => {
    setError(false);
    try {
      const res = await fetch("/api/notifications?pageSize=8", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { items: Item[]; unread: number };
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      setError(true);
    }
  }, []);

  React.useEffect(() => {
    // Initial fetch of the unread badge; data sync with an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function open(item: Item, close: () => void) {
    if (!item.readAt) {
      const res = await fetch(`/api/notifications/${item.id}`, { method: "PATCH" });
      if (res.ok) {
        setItems((xs) => xs?.map((x) => (x.id === item.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? null);
        setUnread((u) => Math.max(0, u - 1));
      }
    }
    if (item.link) {
      close();
      router.push(item.link);
    }
  }

  async function markAll() {
    const res = await fetch("/api/notifications", { method: "POST" });
    if (res.ok) {
      setItems((xs) => xs?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
      setUnread(0);
    }
  }

  return (
    <Dropdown
      label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      panelClassName="w-[min(22rem,calc(100vw-1.5rem))]"
      trigger={
        <span className="relative flex h-10 w-10 items-center justify-center">
          <Bell className="size-[18px]" aria-hidden="true" />
          {unread > 0 ? (
            <span aria-hidden="true" className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-app-primary px-1 text-[10px] font-bold text-app-on-primary">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </span>
      }
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-app-border px-3.5 py-2.5">
            <p className="text-small font-semibold text-app-text">Notifications</p>
            {unread > 0 ? (
              <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-caption text-app-primary hover:text-app-primary-hover">
                <CheckCheck className="size-3.5" aria-hidden="true" /> Mark all read
              </button>
            ) : null}
          </div>
          <div className="app-scroll max-h-96 overflow-y-auto">
            {error ? (
              <ErrorState title="Couldn't load notifications" onRetry={load} className="py-6" />
            ) : items === null ? (
              <LoadingState className="py-6" />
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-small text-app-muted">
                <BellOff className="size-5" aria-hidden="true" /> You&apos;re all caught up.
              </div>
            ) : (
              items.map((n) => (
                <DropdownItem key={n.id} onClick={() => open(n, close)} className="items-start gap-3 py-3">
                  {n.type === "security" ? (
                    <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
                  ) : (
                    <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-app-border-strong" : "bg-app-primary")} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-small", n.readAt ? "text-app-muted" : "font-semibold text-app-text")}>
                      {n.title}
                      {!n.readAt ? <span className="sr-only"> (unread)</span> : null}
                    </span>
                    {n.body ? <span className="block truncate text-caption text-app-subtle">{n.body}</span> : null}
                    <span className="mt-0.5 block text-caption text-app-subtle">{timeAgo(n.createdAt)}</span>
                  </span>
                </DropdownItem>
              ))
            )}
          </div>
        </div>
      )}
    </Dropdown>
  );
}
