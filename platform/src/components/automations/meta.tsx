import {
  Bot,
  Clock,
  FileText,
  Flag,
  GitBranch,
  MessageSquare,
  Tag,
  UserCheck,
  UserPen,
  Webhook,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { BadgeTone } from "@/components/ds";
import {
  CONDITION_FIELD_LABELS,
  NODE_LABELS,
  OPERATOR_LABELS,
  TRIGGER_LABELS,
  delayMinutes,
  type FlowNode,
  type NodeDataMap,
  type NodeType,
  type TriggerData,
} from "@/lib/automations";

export const NODE_ICON: Record<NodeType, LucideIcon> = {
  trigger: Zap,
  message: MessageSquare,
  template: FileText,
  delay: Clock,
  condition: GitBranch,
  tag: Tag,
  assign: UserCheck,
  update_contact: UserPen,
  webhook: Webhook,
  ai_response: Bot,
  end: Flag,
};

/** Accent per node family (icon chip + left border). Text is never colour-only — every node shows its type label. */
export const NODE_ACCENT: Record<NodeType, string> = {
  trigger: "text-amber-300 bg-amber-400/15 border-l-amber-400",
  message: "text-emerald-300 bg-emerald-400/15 border-l-emerald-400",
  template: "text-emerald-300 bg-emerald-400/15 border-l-emerald-400",
  delay: "text-sky-300 bg-sky-400/15 border-l-sky-400",
  condition: "text-violet-300 bg-violet-400/15 border-l-violet-400",
  tag: "text-pink-300 bg-pink-400/15 border-l-pink-400",
  assign: "text-orange-300 bg-orange-400/15 border-l-orange-400",
  update_contact: "text-orange-300 bg-orange-400/15 border-l-orange-400",
  webhook: "text-cyan-300 bg-cyan-400/15 border-l-cyan-400",
  ai_response: "text-fuchsia-300 bg-fuchsia-400/15 border-l-fuchsia-400",
  end: "text-app-muted bg-app-hover border-l-app-border-strong",
};

export const PALETTE: { type: NodeType; hint: string }[] = [
  { type: "message", hint: "Text or reply buttons; can wait for an answer" },
  { type: "template", hint: "Approved template (works outside 24 h)" },
  { type: "delay", hint: "Wait minutes, hours or days" },
  { type: "condition", hint: "Branch Yes / No" },
  { type: "tag", hint: "Add or remove a tag" },
  { type: "assign", hint: "Hand the chat to a person" },
  { type: "update_contact", hint: "Change a contact field" },
  { type: "webhook", hint: "Send data to another app" },
  { type: "ai_response", hint: "Reply with AI" },
  { type: "end", hint: "Stop here" },
];

const unit = (d: NodeDataMap["delay"]) => `${d.amount} ${d.amount === 1 ? d.unit.replace(/s$/, "") : d.unit}`;

/** One-line, human summary shown on the canvas card. */
export function summarize(n: FlowNode, names: { templates: Record<string, string>; users: Record<string, string> }): string {
  switch (n.type) {
    case "trigger": {
      const d = n.data as TriggerData;
      const base = TRIGGER_LABELS[d.trigger];
      if (d.trigger === "keyword") return d.keywords.length ? `${base}: ${d.keywords.slice(0, 3).join(", ")}` : `${base} — add keywords`;
      if (d.trigger === "tag_added") return d.tagName ? `${base}: ${d.tagName}` : base;
      if (d.trigger === "lead_status") return d.leadStatus ? `Lead status → ${d.leadStatus}` : base;
      if (d.trigger === "schedule") return `${d.schedule.frequency === "daily" ? "Daily" : "Weekly"} at ${d.schedule.time} IST${d.schedule.tagName ? ` · ${d.schedule.tagName}` : ""}`;
      if (d.trigger === "button_click" && d.buttonText) return `${base}: “${d.buttonText}”`;
      if (d.trigger === "new_contact") return `${base} (${d.sources.join(", ")})`;
      return base;
    }
    case "message": {
      const d = n.data as NodeDataMap["message"];
      return `${d.text.slice(0, 70) || "Empty message"}${d.buttons.length ? ` · ${d.buttons.length} button${d.buttons.length > 1 ? "s" : ""}` : ""}${d.waitForReply ? " · waits for reply" : ""}`;
    }
    case "template": {
      const d = n.data as NodeDataMap["template"];
      return d.templateId ? names.templates[d.templateId] ?? "Template" : "Choose a template";
    }
    case "delay":
      return `Wait ${unit(n.data as NodeDataMap["delay"])} (${delayMinutes(n.data as NodeDataMap["delay"])} min)`;
    case "condition": {
      const d = n.data as NodeDataMap["condition"];
      const r = d.rules[0];
      if (!r) return "Add a rule";
      const more = d.rules.length > 1 ? ` ${d.match === "all" ? "and" : "or"} ${d.rules.length - 1} more` : "";
      return `If ${CONDITION_FIELD_LABELS[r.field].toLowerCase()} ${OPERATOR_LABELS[r.operator]} ${r.value ? `“${r.value.slice(0, 30)}”` : ""}${more}`;
    }
    case "tag": {
      const d = n.data as NodeDataMap["tag"];
      return `${d.action === "add" ? "Add" : "Remove"} tag ${d.tagName ? `“${d.tagName}”` : "…"}`;
    }
    case "assign": {
      const d = n.data as NodeDataMap["assign"];
      return d.mode === "auto" ? "Least busy agent (online first)" : names.users[d.userId] ?? "Choose a person";
    }
    case "update_contact": {
      const d = n.data as NodeDataMap["update_contact"];
      return `Set ${d.field === "custom" ? d.key || "custom field" : d.field} = ${d.value || "…"}`;
    }
    case "webhook": {
      const d = n.data as NodeDataMap["webhook"];
      try {
        return d.url ? `POST ${new URL(d.url).host}` : "Add a URL";
      } catch {
        return "Add a valid URL";
      }
    }
    case "ai_response": {
      const d = n.data as NodeDataMap["ai_response"];
      return d.instructions ? d.instructions.slice(0, 70) : "Add instructions";
    }
    case "end":
      return "Automation ends";
  }
}

export const nodeTitle = (n: FlowNode) => (n.data as { label?: string }).label || NODE_LABELS[n.type];

export const EXEC_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  stopped: { label: "Stopped", tone: "warning" },
};

export const STEP_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  completed: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Skipped", tone: "neutral" },
  waiting: { label: "Waiting for reply", tone: "info" },
  retrying: { label: "Retrying", tone: "warning" },
};

export const AUTO_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  inactive: { label: "Inactive", tone: "warning" },
};
