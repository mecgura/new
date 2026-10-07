import type { BadgeTone } from "@/components/ds";
import type { Slot, TemplateDef, TemplateStatus } from "@/lib/templates";

export type TemplateView = TemplateDef & {
  id: string;
  status: TemplateStatus;
  slots: Slot[];
  metaTemplateId: string | null;
  metaStatus: string;
  rejectedReason: string;
  qualityScore: string;
  source: string;
  isDemo: boolean;
  waba: { id: string; name: string; isDemo: boolean; numbers: { id: string; displayName: string; phoneNumber: string }[] };
  createdBy: string | null;
  campaigns: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TemplateAccount = { id: string; name: string; isDemo: boolean; accounts: { id: string; displayName: string; phoneNumber: string }[] };

export const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  paused: "danger",
  disabled: "danger",
};

export const QUALITY: Record<string, { label: string; tone: BadgeTone }> = {
  GREEN: { label: "High", tone: "success" },
  YELLOW: { label: "Medium", tone: "warning" },
  RED: { label: "Low", tone: "danger" },
  UNKNOWN: { label: "Not rated", tone: "neutral" },
};

export function wabaLabel(w: { name: string; isDemo: boolean; accounts?: { displayName: string }[]; numbers?: { displayName: string }[] }) {
  const nums = (w.accounts ?? w.numbers ?? []).map((a) => a.displayName).join(", ");
  return `${w.name || "WhatsApp account"}${nums ? ` · ${nums}` : ""}${w.isDemo ? " (demo)" : ""}`;
}
