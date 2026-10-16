import { Alert, Progress } from "@/components/ui";
import type { UsageRow } from "@/lib/services/entitlements";

const LEVEL_NOTE = { warn80: "80% used", warn90: "90% used — nearly full", full: "Limit reached" } as const;
/** Usage against the plan, from live data. 80 / 90 / 100% are called out in words, not just colour. */
export function UsageMeters({ rows, windowStart }: { rows: UsageRow[]; windowStart: Date | string | null }) {
  const shown = rows.filter((r) => r.metered);
  const hot = shown.filter((r) => r.level !== "ok");
  return (
    <div className="space-y-4">
      {hot.length > 0 && <Alert tone={hot.some((r) => r.level === "full") ? "danger" : "warning"} title="Plan limits">{hot.map((r) => `${r.label}: ${LEVEL_NOTE[r.level as keyof typeof LEVEL_NOTE]}`).join(" · ")}. Only the affected action is blocked; nothing is deleted. Upgrade to add more.</Alert>}
      <ul className="grid gap-4 sm:grid-cols-2">
        {shown.map((r) => (
          <li key={r.key}>
            {r.mode === "LIMITED" && r.limit !== null ? <Progress value={r.used} max={Math.max(1, r.limit)} label={`${r.label}: ${r.used.toLocaleString("en-IN")} of ${r.limit.toLocaleString("en-IN")}${r.unit === "MB" ? " MB" : ""}`} />
              : <div><span className="type-caption">{r.label}</span><p className="type-body">{r.used.toLocaleString("en-IN")} used · {r.mode === "DISABLED" ? "not included in your plan" : "unlimited"}</p></div>}
            <p className="type-caption mt-1">{r.period === "period" ? "Counted per billing month" : "Current total"}</p>
          </li>
        ))}
      </ul>
      {windowStart && <p className="type-caption">Monthly counters started {new Date(windowStart).toISOString().slice(0, 10)} (UTC).</p>}
    </div>
  );
}
