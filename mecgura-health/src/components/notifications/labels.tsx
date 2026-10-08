import { AlertOctagon, AlertTriangle, ArrowDown, Bell, Info } from "lucide-react";

export const PRIORITY: Record<string, { label: string; tone: "neutral" | "info" | "warning" | "danger"; Icon: typeof Bell }> = {
  LOW: { label: "Low", tone: "neutral", Icon: ArrowDown }, NORMAL: { label: "Normal", tone: "info", Icon: Info }, HIGH: { label: "High", tone: "warning", Icon: AlertTriangle },
  URGENT: { label: "Urgent", tone: "danger", Icon: AlertTriangle }, CRITICAL: { label: "Critical", tone: "danger", Icon: AlertOctagon },
};
const TONE: Record<string, string> = { neutral: "text-muted", info: "text-primary", warning: "text-warning", danger: "text-danger" };
/** Priority is shown with an icon AND a word, never colour alone. */
export function PriorityMark({ priority, compact }: { priority: string; compact?: boolean }) {
  const p = PRIORITY[priority] ?? PRIORITY.NORMAL; const Icon = p.Icon;
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold ${TONE[p.tone]}`}><Icon aria-hidden className="size-3.5" />{compact && priority === "NORMAL" ? <span className="sr-only">{p.label} priority</span> : <span>{p.label}</span>}</span>;
}
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
export const full = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export interface Row { id: string; type: string; category: string; categoryLabel: string; priority: string; title: string; body: string | null; actionUrl: string | null; entityType: string | null; entityId?: string | null; read: boolean; archived: boolean; expired: boolean; ackRequired: boolean; acknowledged: boolean; groupCount: number; createdAt: string }
export const actionLabel = (n: Pick<Row, "category" | "entityType" | "type">) => (n.type === "OPD_CHECKED_IN" ? "Open queue" : n.category === "LAB" ? "Open report" : n.category === "BILLING" ? "View bill" : n.category === "PHARMACY" ? "Open stock" : n.category === "FOLLOWUP" ? "Open follow-up" : n.category === "SECURITY" ? "Review security" : n.category === "APPOINTMENT" ? "View appointment" : n.category === "PATIENT" ? "Open" : n.category === "CLINICAL" ? "View prescription" : "Open");
