import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime/broker";
import { runAfterResponse } from "@/lib/background";
import type { OrgAccess } from "@/lib/session";
import { runExecution } from "@/services/automations/engine";

/** Approval requests from automations' Approval steps. Stale ones (run stopped/finished) are cancelled on read. */
export async function listApprovals(access: OrgAccess, status: "pending" | "decided" = "pending") {
  const orgId = access.organizationId;
  if (status === "pending") {
    const pending = await db.automationApproval.findMany({ where: { organizationId: orgId, status: "pending" }, select: { id: true, executionId: true } });
    const live = await db.automationExecution.findMany({ where: { id: { in: pending.map((p) => p.executionId) }, status: { in: ["queued", "running"] } }, select: { id: true } });
    const liveIds = new Set(live.map((l) => l.id));
    const stale = pending.filter((p) => !liveIds.has(p.executionId)).map((p) => p.id);
    if (stale.length) await db.automationApproval.updateMany({ where: { id: { in: stale }, status: "pending" }, data: { status: "cancelled", decidedAt: new Date() } });
  }
  const rows = await db.automationApproval.findMany({
    where: { organizationId: orgId, ...(status === "pending" ? { status: "pending" } : { status: { not: "pending" } }) },
    orderBy: status === "pending" ? { expiresAt: "asc" } : { decidedAt: "desc" },
    take: 100,
  });
  const [automations, contacts, users] = await Promise.all([
    db.automation.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.automationId))] } }, select: { id: true, name: true } }),
    db.contact.findMany({ where: { organizationId: orgId, id: { in: rows.map((r) => r.contactId).filter((x): x is string => !!x) } }, select: { id: true, name: true, phone: true } }),
    db.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.decidedById, r.approverUserId]).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  return rows.map((r) => ({
    id: r.id,
    automation: automations.find((a) => a.id === r.automationId) ?? { id: r.automationId, name: "Deleted automation" },
    contact: contacts.find((c) => c.id === r.contactId) ?? null,
    question: r.question,
    status: r.status,
    note: r.note,
    approver: r.approverUserId ? (users.find((u) => u.id === r.approverUserId)?.name ?? "A team member") : "Any owner or manager",
    canDecide: r.status === "pending" && mayDecide(access, r.approverUserId),
    decidedBy: users.find((u) => u.id === r.decidedById)?.name ?? null,
    decidedAt: r.decidedAt,
    expiresAt: r.expiresAt,
    executionId: r.executionId,
    createdAt: r.createdAt,
  }));
}

function mayDecide(access: OrgAccess, approverUserId: string | null) {
  if (access.isPlatformAdmin || access.role === "CLIENT_OWNER") return true; // the owner can always step in
  if (approverUserId) return approverUserId === access.user.id;
  return access.role === "MANAGER";
}

export async function decideApproval(access: OrgAccess, id: string, decision: "approved" | "rejected", note: string, req?: Request) {
  const a = await db.automationApproval.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!a) throw new ApiError("NOT_FOUND", "Approval request not found.");
  if (!mayDecide(access, a.approverUserId)) throw new ApiError("FORBIDDEN", "This approval is assigned to someone else.");
  const ex = await db.automationExecution.findUnique({ where: { id: a.executionId }, select: { status: true } });
  if (!ex || !["queued", "running"].includes(ex.status)) {
    await db.automationApproval.updateMany({ where: { id, status: "pending" }, data: { status: "cancelled", decidedAt: new Date() } });
    throw new ApiError("CONFLICT", "This automation run has already ended.");
  }
  const r = await db.automationApproval.updateMany({ where: { id, status: "pending", expiresAt: { gt: new Date() } }, data: { status: decision, note: note.slice(0, 500), decidedById: access.user.id, decidedAt: new Date() } });
  if (!r.count) throw new ApiError("CONFLICT", "This request was already decided or has expired.");
  // Wake the run now; the Approval step reads the decision and takes its branch.
  await db.automationExecution.updateMany({ where: { id: a.executionId, waitState: "approval" }, data: { waitState: "", nextRunAt: new Date() } });
  runAfterResponse(() => runExecution(a.executionId));
  await audit({ action: "automation.approval_decided", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "automation", targetId: a.automationId, metadata: { decision, approvalId: id }, req });
  publish(access.organizationId, { type: "automation.updated", automationId: a.automationId });
  return { id, status: decision };
}
