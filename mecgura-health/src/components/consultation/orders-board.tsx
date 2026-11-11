"use client";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingState, Select, StatusBadge, useToast } from "@/components/ui";
import { usePolling } from "@/components/scheduling/use-poll";
import { apiFetch } from "@/lib/api/client";

interface Order { id: string; type: string; title: string; description: string | null; priority: string; status: string; consultationId: string; patient: { code: string; name: string } | null }
const TONE: Record<string, "warning" | "info" | "success" | "neutral"> = { PENDING: "warning", IN_PROGRESS: "info", COMPLETED: "success", CANCELLED: "neutral" };

/** Operational task list for doctor orders. Staff move tasks along; they can't see or change the prescription from here. */
export function OrdersBoard({ canUpdate, canCancel }: { canUpdate: boolean; canCancel: boolean }) {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const { data, error, loading, refresh } = usePolling<{ orders: Order[] }>(`/api/orders${status ? `?status=${status}` : ""}`, { intervalMs: 15000 });
  async function move(id: string, to: string) {
    const r = await apiFetch(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status: to }) });
    if (r.ok) { toast({ tone: "success", title: "Order updated" }); await refresh(); } else toast({ tone: "danger", title: r.error.message });
  }
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="type-page-title">Orders</h1><p className="type-secondary mt-1">Tasks created by doctors. Updates automatically.</p></div>
        <Field label="Show"><Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Open orders" options={[{ value: "PENDING", label: "Pending" }, { value: "IN_PROGRESS", label: "In progress" }, { value: "COMPLETED", label: "Completed" }, { value: "CANCELLED", label: "Cancelled" }]} /></Field>
      </div>
      <Card>
        {loading && !data ? <LoadingState /> : error && !data ? <ErrorState code={error.code} description={error.message} action={<Button onClick={refresh}>Try again</Button>} /> : !data?.orders.length ? <EmptyState title="No orders" description="Nothing is waiting for you." /> : (
          <ul className="divide-y divide-line">
            {data.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 p-card">
                <div className="min-w-0 flex-1 basis-60"><p className="type-label">{o.title}</p><p className="type-caption">{o.type.replace("_", " ").toLowerCase()}{o.patient ? ` · ${o.patient.name} (${o.patient.code})` : ""}</p>{o.description && <p className="type-secondary">{o.description}</p>}</div>
                <div className="flex flex-wrap items-center gap-2">
                  {o.priority !== "NORMAL" && <Badge tone={o.priority === "URGENT" ? "danger" : "warning"}>{o.priority.toLowerCase()}</Badge>}
                  <StatusBadge tone={TONE[o.status]}>{o.status.replace("_", " ").toLowerCase()}</StatusBadge>
                  {canUpdate && o.status === "PENDING" && <Button size="sm" variant="outline" onClick={() => move(o.id, "IN_PROGRESS")}>Start</Button>}
                  {canUpdate && (o.status === "PENDING" || o.status === "IN_PROGRESS") && <Button size="sm" onClick={() => move(o.id, "COMPLETED")}>Complete</Button>}
                  {canCancel && (o.status === "PENDING" || o.status === "IN_PROGRESS") && <Button size="sm" variant="ghost" onClick={() => move(o.id, "CANCELLED")}>Cancel</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
