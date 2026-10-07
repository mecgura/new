import type { BadgeTone } from "@/components/ds";
import type { Audience, AudienceFilters, VariableMapping } from "@/lib/validations";

export type CheckStatus = "pass" | "warn" | "fail";
export type ComplianceReport = {
  checks: { key: string; label: string; status: CheckStatus; detail: string }[];
  total: number;
  eligible: number;
  removed: number;
  reasons: Partial<Record<string, number>>;
  removedSample: { name: string; phone: string; reason: string }[];
  canSend: boolean;
  generatedAt: string;
};

export type CampaignStats = { total: number; queued: number; sent: number; delivered: number; read: number; failed: number; skipped: number; replies: number; optOuts: number };

export type CampaignView = {
  id: string;
  name: string;
  description: string;
  status: string;
  statusReason: string;
  step: number;
  isDemo: boolean;
  account: { id: string; displayName: string; phoneNumber: string; status: string; isDemo: boolean } | null;
  template: { id: string; name: string; language: string; category: string; status: string; qualityScore: string } | null;
  segment: { id: string; name: string } | null;
  audience: Audience;
  variables: Record<string, VariableMapping>;
  scheduledAt: string | null;
  review: ComplianceReport | null;
  reviewedAt: string | null;
  totalRecipients: number;
  createdBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats: CampaignStats;
};

export type SegmentView = { id: string; name: string; description: string; filters: AudienceFilters; campaigns: number; contacts: number; createdAt: string };

export const CAMPAIGN_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "info" },
  sending: { label: "Sending", tone: "primary" },
  paused: { label: "Paused", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

export const REASON_LABELS: Record<string, string> = {
  invalid_phone: "Invalid or own phone number",
  duplicate: "Duplicate phone number",
  opted_out: "Opted out",
  suppressed: "On the suppression list",
  no_consent: "No opt-in recorded",
  frequency_cap: "Got a marketing message in the last 24 h",
  missing_variable: "Missing variable value",
};

export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");

/** Fixed IST formatting so server and client render identically. */
export const istFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
