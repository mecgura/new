"use client";

import * as React from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dropdown, DropdownItem, DropdownLabel, DropdownSeparator, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type AiState = { agent: { id: string; name: string; resume: string } | null; status: string; reason: string; resumeAt: string | null; mode: "live" | "demo" | null };

const RESUME: Record<string, string> = { manual: "Resumes only when someone clicks Resume AI", on_close: "Resumes when the chat is closed", after_hours: "Resumes after the set hours without a team reply" };

/** AI agent status for one chat, with pause / resume / summarise. Hidden when no agent covers the number. */
export function AiControl({ orgId, conversationId, refreshKey, canReply, onChanged }: { orgId: string; conversationId: string; refreshKey: number; canReply: boolean; onChanged: () => void }) {
  const toast = useToast();
  const url = `/api/organizations/${orgId}/inbox/conversations/${conversationId}/ai`;
  const [ai, setAi] = React.useState<AiState | null>(null);
  React.useEffect(() => {
    let alive = true;
    void apiFetch<{ ai: AiState }>(url).then((r) => alive && r.ok && setAi(r.data.ai));
    return () => {
      alive = false;
    };
  }, [url, refreshKey]);
  if (!ai?.agent) return null;
  const off = ai.status === "handoff";
  const label = off ? "AI paused" : ai.mode === "demo" ? "Demo AI" : ai.mode === "live" ? "AI on" : "AI off";

  async function act(action: "pause" | "resume" | "summarize") {
    const r = await apiFetch<{ ai: AiState; summary?: string }>(url, { method: "POST", body: { action } });
    if (!r.ok) return toast(r.error, "error");
    setAi(r.data.ai);
    toast(action === "pause" ? "AI paused in this chat" : action === "resume" ? "Chat handed back to the AI" : "Summary added as an internal note");
    onChanged();
  }
  return (
    <Dropdown
      label="AI agent"
      trigger={
        <span className={cn("flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-small", off || !ai.mode ? "border-app-border text-app-muted" : ai.mode === "demo" ? "border-amber-500/40 text-amber-200" : "border-sky-500/40 text-sky-200")}>
          <Bot className="size-4" aria-hidden="true" />
          <span className="hidden lg:inline">{label}</span>
        </span>
      }
    >
      {(close) => (
        <>
          <DropdownLabel>
            {ai.agent!.name} · {off ? `paused${ai.reason ? ` — ${ai.reason}` : ""}` : ai.mode === "demo" ? "Demo AI (rule-based)" : ai.mode === "live" ? "answering" : "live AI not configured"}
          </DropdownLabel>
          {off ? <DropdownLabel>{RESUME[ai.agent!.resume] ?? ""}</DropdownLabel> : null}
          <DropdownSeparator />
          {canReply ? (
            off ? (
              <DropdownItem onClick={() => { close(); void act("resume"); }}>Resume AI (hand back)</DropdownItem>
            ) : (
              <DropdownItem onClick={() => { close(); void act("pause"); }}>Pause AI in this chat</DropdownItem>
            )
          ) : null}
          {canReply ? <DropdownItem onClick={() => { close(); void act("summarize"); }}>Summarize conversation</DropdownItem> : null}
        </>
      )}
    </Dropdown>
  );
}
