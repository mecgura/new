"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { NotificationView } from "@/lib/services/lab-results";
import { fmt } from "./lab-ui";

const href = (n: NotificationView) => (n.entityType === "lab_report" ? `/lab/reports/${n.entityId}` : n.entityType === "investigation_order" ? `/lab/orders/${n.entityId}` : null);

/** In-app notifications only (no SMS, WhatsApp or email). Text never contains result values. */
export function NotificationsCard() {
  const [data, setData] = useState<{ unread: number; items: NotificationView[] } | null>(null);
  const load = useCallback(async () => { const r = await apiFetch<{ unread: number; items: NotificationView[] }>("/api/notifications"); if (r.ok) setData(r.data); }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  if (!data) return null;
  async function read(id?: string) { await apiFetch("/api/notifications", { method: "POST", body: JSON.stringify(id ? { id } : {}) }); await load(); }
  return (
    <Card aria-label="Notifications">
      <CardHeader title={<span className="inline-flex items-center gap-2"><Bell aria-hidden className="size-4" />Notifications {data.unread > 0 && <Badge tone="primary">{data.unread} new</Badge>}</span>} action={data.unread > 0 ? <Button size="sm" variant="ghost" onClick={() => read()}>Mark all read</Button> : undefined} />
      {!data.items.length ? <EmptyState title="No notifications" description="Report and sample updates will appear here." /> : (
        <ul className="divide-y divide-line">{data.items.slice(0, 6).map((n) => {
          const h = href(n);
          return <li key={n.id} className="p-card"><p className={n.read ? "type-body" : "type-label"}>{h ? <Link href={h} onClick={() => read(n.id)}>{n.title}</Link> : n.title}</p>{n.body && <p className="type-secondary">{n.body}</p>}<p className="type-caption">{fmt(n.createdAt)}</p></li>;
        })}</ul>
      )}
    </Card>
  );
}
