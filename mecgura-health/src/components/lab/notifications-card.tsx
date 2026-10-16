"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { fmt } from "./lab-ui";

interface Row { id: string; title: string; body: string | null; read: boolean; createdAt: string; actionUrl: string | null }
/** The same notifications as the bell and /notifications (Phase 12), shown on the lab / follow-up pages. In-app only; text never contains result values. */
export function NotificationsCard() {
  const [data, setData] = useState<{ rows: Row[]; unread: number } | null>(null);
  const load = useCallback(async () => {
    const [l, c] = await Promise.all([apiFetch<{ rows: Row[] }>("/api/notifications?pageSize=6"), apiFetch<{ unread: number }>("/api/notifications/unread-count")]);
    if (l.ok && c.ok) setData({ rows: l.data.rows, unread: c.data.unread });
  }, []);
  useEffect(() => { void load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  if (!data) return null;
  async function read(id?: string) { await apiFetch(id ? `/api/notifications/${id}/read` : "/api/notifications/mark-all-read", { method: id ? "PATCH" : "POST" }); await load(); }
  return (
    <Card aria-label="Notifications">
      <CardHeader title={<span className="inline-flex items-center gap-2"><Bell aria-hidden className="size-4" />Notifications {data.unread > 0 && <Badge tone="primary">{data.unread} new</Badge>}</span>} action={data.unread > 0 ? <Button size="sm" variant="ghost" onClick={() => read()}>Mark all read</Button> : <Link href="/notifications" className="type-label">View all</Link>} />
      {!data.rows.length ? <EmptyState title="No notifications" description="Report and sample updates will appear here." /> : (
        <ul className="divide-y divide-line">{data.rows.map((n) => (
          <li key={n.id} className="p-card"><p className={n.read ? "type-body" : "type-label"}>{n.actionUrl ? <Link href={n.actionUrl} onClick={() => read(n.id)}>{n.title}</Link> : n.title}</p>{n.body && <p className="type-secondary">{n.body}</p>}<p className="type-caption">{fmt(n.createdAt)}</p></li>
        ))}</ul>
      )}
    </Card>
  );
}
