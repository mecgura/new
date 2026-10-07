"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { NODE_LABELS, type FlowNode, type NodeType } from "@/lib/automations";
import { NODE_ACCENT, NODE_ICON, nodeTitle, summarize } from "@/components/automations/meta";

export type BuilderInfo = {
  issues: Record<string, string[]>;
  stats: Record<string, Record<string, number>> | null;
  names: { templates: Record<string, string>; users: Record<string, string> };
  activeNodeId: string | null;
};

export const BuilderContext = React.createContext<BuilderInfo>({ issues: {}, stats: null, names: { templates: {}, users: {} }, activeNodeId: null });

const handleCls = "!size-3 !border-2 !border-app-surface";

/** One card per step. Status is shown with text + icon, never colour alone. */
export function FlowNodeCard({ id, type, data, selected }: NodeProps) {
  const info = React.useContext(BuilderContext);
  const t = type as NodeType;
  const node = { id, type: t, position: { x: 0, y: 0 }, data } as unknown as FlowNode;
  const Icon = NODE_ICON[t];
  const issues = info.issues[id] ?? [];
  const s = info.stats?.[id];
  const accent = NODE_ACCENT[t];
  return (
    <div
      className={cn(
        "w-[248px] rounded-xl border border-l-4 border-app-border bg-app-surface text-left shadow-lg shadow-black/30 transition-shadow",
        accent.split(" ").find((c) => c.startsWith("border-l-")),
        selected && "ring-2 ring-app-primary",
        info.activeNodeId === id && "ring-2 ring-sky-400"
      )}
    >
      {t !== "trigger" ? <Handle type="target" position={Position.Top} className={cn(handleCls, "!bg-app-muted")} aria-label="Input" /> : null}
      <div className="flex items-start gap-2.5 p-3">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", accent.split(" ").filter((c) => !c.startsWith("border-l-")).join(" "))}>
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-app-subtle">{NODE_LABELS[t]}</p>
          <p className="truncate text-small font-medium text-app-text">{nodeTitle(node)}</p>
          <p className="mt-0.5 line-clamp-2 text-caption text-app-muted">{summarize(node, info.names)}</p>
        </div>
        {issues.length ? (
          <span title={issues.join("\n")} className="flex items-center gap-0.5 text-[10px] font-medium text-red-300">
            <AlertCircle className="size-4" aria-hidden="true" />
            <span className="sr-only">{issues.length} problem(s): {issues.join(". ")}</span>
          </span>
        ) : null}
      </div>
      {s ? (
        <div className="flex gap-3 border-t border-app-border px-3 py-1.5 text-[10px] tabular-nums text-app-muted">
          <span>✓ {s.completed ?? 0}</span>
          {s.failed ? <span className="text-red-300">✕ {s.failed}</span> : null}
          {s.waiting ? <span>⏳ {s.waiting}</span> : null}
          {s.retrying ? <span className="text-amber-300">↻ {s.retrying}</span> : null}
          {s.skipped ? <span>⤼ {s.skipped}</span> : null}
        </div>
      ) : null}
      {t === "condition" ? (
        <>
          <Handle id="yes" type="source" position={Position.Bottom} style={{ left: "28%" }} className={cn(handleCls, "!bg-emerald-400")} aria-label="Yes" />
          <Handle id="no" type="source" position={Position.Bottom} style={{ left: "72%" }} className={cn(handleCls, "!bg-red-400")} aria-label="No" />
          <div className="flex justify-between px-[20%] pb-1 text-[10px] font-semibold">
            <span className="text-emerald-300">Yes</span>
            <span className="text-red-300">No</span>
          </div>
        </>
      ) : t !== "end" ? (
        <Handle id="next" type="source" position={Position.Bottom} className={cn(handleCls, "!bg-app-primary")} aria-label="Next" />
      ) : null}
    </div>
  );
}
