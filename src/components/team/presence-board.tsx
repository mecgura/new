"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Avatar, Badge, Card, CardHeader, Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { ORG_ROLE_LABELS, isOrgRole } from "@/lib/authz";
import { useRealtime } from "@/components/inbox/use-realtime";
import type { TeamMember } from "@/components/inbox/types";

const PRESENCE: Record<string, { label: string; dot: string; tone: "success" | "warning" | "neutral" }> = {
  online: { label: "Online", dot: "bg-app-success", tone: "success" },
  away: { label: "Away", dot: "bg-app-warning", tone: "warning" },
  offline: { label: "Offline", dot: "bg-app-subtle", tone: "neutral" },
};

/** Live availability + workload. Updates arrive over SSE (no polling). */
export function PresenceBoard({ orgId, meId, initial }: { orgId: string; meId: string; initial: TeamMember[] }) {
  const toast = useToast();
  const [members, setMembers] = React.useState(initial);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ members: TeamMember[] }>(`/api/organizations/${orgId}/team`);
    if (r.ok) setMembers(r.data.members);
  }, [orgId]);
  useRealtime(orgId, (e) => (e.type === "team.presence" || e.type === "conversation.updated") && void load(), load);
  const me = members.find((m) => m.userId === meId);

  async function change(status: string) {
    const r = await apiFetch(`/api/organizations/${orgId}/team/status`, { method: "PUT", body: { status } });
    if (!r.ok) return toast(r.error, "error");
    toast(`You're now ${PRESENCE[status].label.toLowerCase()}`);
    void load();
  }

  return (
    <Card>
      <CardHeader
        title="Availability"
        description="Who's taking chats right now, and how many open chats each person holds."
        action={
          me ? (
            <label className="flex items-center gap-2 text-small text-app-muted">
              My status
              <Select aria-label="My availability" value={me.agentStatus} onChange={(e) => change(e.target.value)} className="h-9 w-32">
                {Object.entries(PRESENCE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
            </label>
          ) : null
        }
      />
      <ul className="divide-y divide-app-border">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3 px-5 py-3">
            <span className="relative">
              <Avatar name={m.name} size="sm" />
              <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-app-surface", PRESENCE[m.agentStatus]?.dot)} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body text-app-text">{m.name}{m.userId === meId ? <span className="text-app-subtle"> (you)</span> : null}</p>
              <p className="truncate text-caption text-app-muted">{isOrgRole(m.role) ? ORG_ROLE_LABELS[m.role] : m.role}</p>
            </div>
            <span className="text-caption tabular-nums text-app-muted">{m.openChats} open</span>
            <Badge tone={PRESENCE[m.agentStatus]?.tone ?? "neutral"}>{PRESENCE[m.agentStatus]?.label ?? m.agentStatus}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
