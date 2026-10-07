import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { publish } from "@/lib/realtime/broker";
import type { OrgAccess } from "@/lib/session";

export const AGENT_STATUSES = ["online", "away", "offline"] as const;

export async function setAgentStatus(access: OrgAccess, status: (typeof AGENT_STATUSES)[number]) {
  const m = await db.organizationMember.findFirst({ where: { organizationId: access.organizationId, userId: access.user.id } });
  if (!m) throw new ApiError("FORBIDDEN", "Only workspace members have an availability status.");
  await db.organizationMember.update({ where: { id: m.id }, data: { agentStatus: status, agentStatusAt: new Date() } });
  publish(access.organizationId, { type: "team.presence", userId: access.user.id, status });
  return { status };
}

/** Members with availability and open-chat workload (for assignment pickers and the Team page). */
export async function listTeam(organizationId: string) {
  const [members, load] = await Promise.all([
    db.organizationMember.findMany({
      where: { organizationId, user: { status: "active" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, agentStatus: true, agentStatusAt: true, user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
    }),
    db.conversation.groupBy({ by: ["assignedToUserId"], where: { organizationId, status: "open", assignedToUserId: { not: null } }, _count: { _all: true } }),
  ]);
  return members.map((m) => ({
    memberId: m.id,
    userId: m.user.id,
    name: m.user.name ?? m.user.email,
    email: m.user.email,
    role: m.role,
    agentStatus: m.agentStatus,
    agentStatusAt: m.agentStatusAt,
    openChats: load.find((l) => l.assignedToUserId === m.user.id)?._count._all ?? 0,
  }));
}
