import { StatusBadge } from "@/components/ui";
import type { auditCenter } from "@/lib/services/platform-admin";

type Row = Awaited<ReturnType<typeof auditCenter>>["rows"][number];
const TONE = { high: "danger", notice: "warning", info: "neutral" } as const;
const fmt = (d: Date) => d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const show = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v, null, 2));

/** Audit entries with an expandable detail (actor, role, entity, device and before/after). Server-rendered; nothing here can edit an entry. */
export function AuditTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="type-secondary rounded-lg border border-line bg-surface p-6 text-center">No audit entries match.</p>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface" aria-label="Audit entries">
      {rows.map((r) => (
        <li key={r.id} className="p-3">
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
              <StatusBadge tone={TONE[r.severity]}>{r.severity === "high" ? "High" : r.severity === "notice" ? "Notice" : "Info"}</StatusBadge>
              <span className="type-label">{r.action}</span><span className="type-caption">{r.category}</span><span className="type-caption">{r.clinic}</span><span className="type-caption">{r.actor}{r.actorRole ? ` (${r.actorRole.toLowerCase().replace(/_/g, " ")})` : ""}</span><span className="type-caption ml-auto tabular-nums">{fmt(r.at)}</span>
            </summary>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[9rem_1fr]">
              <dt className="type-caption">Entity</dt><dd className="break-all">{r.entityType ?? "—"} {r.entityId ?? ""}</dd>
              <dt className="type-caption">IP address</dt><dd>{r.ip ?? "Not recorded"}</dd><dt className="type-caption">Device</dt><dd className="break-words">{r.device ?? "Not recorded"}</dd>
              {r.before !== null && <><dt className="type-caption">Before</dt><dd><pre className="overflow-x-auto rounded bg-surface-muted p-2 text-xs">{show(r.before)}</pre></dd></>}
              {r.after !== null && <><dt className="type-caption">After</dt><dd><pre className="overflow-x-auto rounded bg-surface-muted p-2 text-xs">{show(r.after)}</pre></dd></>}
              <dt className="type-caption">Details</dt><dd><pre className="overflow-x-auto rounded bg-surface-muted p-2 text-xs">{r.metadata ? show(r.metadata) : "—"}</pre></dd>
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}
