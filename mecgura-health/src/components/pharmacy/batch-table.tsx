"use client";
import Link from "next/link";
import { useState } from "react";
import { DataTable, StatusBadge } from "@/components/ui";
import type { BatchRow } from "@/lib/services/pharmacy-inventory";
import { BatchActionModal, BlockModal } from "./stock-actions";
import { BATCH_LABEL, BATCH_TONE, dayLabel, daysText, useMoney, usePharmacy } from "./pharmacy-ui";
import { Button } from "@/components/ui";

type Row = Omit<BatchRow, "medicineCode" | "unit" | "expiry"> & Partial<Pick<BatchRow, "medicineCode" | "unit" | "expiry">>;
/** Batch table with the stock actions the user is allowed to perform. `showMedicine` adds the medicine column (stock / expiry pages). */
export function BatchTable({ rows, loading, onChanged, showMedicine = true, caption = "Batches", emptyTitle = "No batches found.", mode = "stock" }: { rows: Row[]; loading?: boolean; onChanged: () => Promise<void> | void; showMedicine?: boolean; caption?: string; emptyTitle?: string; mode?: "stock" | "expiry" }) {
  const { perms } = usePharmacy(); const money = useMoney();
  const [act, setAct] = useState<{ kind: "adjust" | "damage" | "expire" | "block"; row: Row } | null>(null);
  const done = async () => { setAct(null); await onChanged(); };
  const lite = (r: Row) => ({ id: r.id, medicineName: r.medicineName, batchNumber: r.batchNumber, quantityAvailable: r.quantityAvailable, expiryDate: r.expiryDate, status: r.status });
  return (
    <>
      <DataTable caption={caption} loading={loading} rows={rows} rowKey={(r) => r.id} empty={{ title: emptyTitle }}
        columns={[
          ...(showMedicine ? [{ key: "med", header: "Medicine", cell: (r: Row) => <Link href={`/pharmacy/medicines/${r.medicineId}`} className="type-label">{r.medicineName}</Link> }] : []),
          { key: "batch", header: "Batch", cell: (r: Row) => <Link href={`/pharmacy/stock/${r.id}`} className="tabular-nums">{r.batchNumber}</Link> },
          { key: "exp", header: "Expiry", cell: (r: Row) => dayLabel(r.expiryDate) },
          { key: "days", header: "Days remaining", align: "right", cell: (r: Row) => <span className={r.daysRemaining < 0 ? "!text-danger" : ""}>{daysText(r.daysRemaining)}</span> },
          { key: "qty", header: "Available", align: "right", cell: (r: Row) => <span className="tabular-nums">{r.quantityAvailable}</span> },
          { key: "price", header: "Selling price", align: "right", cell: (r: Row) => <span className="tabular-nums">{money(r.sellingPriceMinor)}</span>, hideOnMobile: true },
          { key: "status", header: "Status", cell: (r: Row) => <StatusBadge tone={BATCH_TONE[r.displayStatus]}>{BATCH_LABEL[r.displayStatus]}</StatusBadge> },
          { key: "act", header: "Actions", cell: (r: Row) => (
            <div className="flex flex-wrap justify-end gap-1">
              <Link href={`/pharmacy/stock/${r.id}`} className="type-label inline-flex min-h-9 items-center px-2">View</Link>
              {perms.adjust && mode === "stock" && r.displayStatus !== "EXPIRED" && <Button size="sm" variant="outline" onClick={() => setAct({ kind: "adjust", row: r })}>Adjust</Button>}
              {perms.adjust && mode === "stock" && r.quantityAvailable > 0 && <Button size="sm" variant="outline" onClick={() => setAct({ kind: "damage", row: r })}>Damage</Button>}
              {perms.adjust && <Button size="sm" variant="outline" onClick={() => setAct({ kind: "block", row: r })}>{r.status === "BLOCKED" ? "Unblock" : "Block"}</Button>}
              {perms.adjust && r.displayStatus === "EXPIRED" && r.quantityAvailable > 0 && <Button size="sm" variant="danger" onClick={() => setAct({ kind: "expire", row: r })}>Dispose</Button>}
            </div>
          ) },
        ]} />
      {act && act.kind !== "block" && <BatchActionModal kind={act.kind} batch={lite(act.row)} onClose={() => setAct(null)} onDone={done} />}
      {act && act.kind === "block" && <BlockModal batch={lite(act.row)} onClose={() => setAct(null)} onDone={done} />}
    </>
  );
}
