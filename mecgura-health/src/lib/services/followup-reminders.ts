import "server-only";
import type { TenantRequestContext } from "@/lib/auth/context";
import { OPEN_STATUSES } from "@/lib/followups/core";
import { todayIn } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { tenantTimezone, type Client } from "./clinic-shared";
import { scopeWhere } from "./followups";

/**
 * Internal reminder engine foundation. Reminders are IN-APP notifications only: no SMS, WhatsApp or email is sent.
 * They are produced lazily when a user's notifications load (no background job), at most one per kind per user per day, and only
 * when the count is non-zero. Future channels (Phase 10) can subscribe to the same kinds: FOLLOW_UP_DUE, FOLLOW_UP_OVERDUE, RECALL_DUE, REPORT_REVIEW.
 */
export const REMINDER_KINDS = ["FOLLOW_UP_DUE", "FOLLOW_UP_OVERDUE", "RECALL_DUE", "REPORT_REVIEW"] as const;

export async function syncReminders(ctx: TenantRequestContext) {
  if (ctx.user.role === "SUPER_ADMIN") return;
  const tdb = tenantDb(ctx) as Client;
  const today = todayIn(await tenantTimezone(ctx.tenantId));
  const make = async (type: string, count: number, title: string, entityType: string) => {
    if (count < 1) return;
    if (await tdb.notification.findFirst({ where: { userId: ctx.user.id, type, entityId: today }, select: { id: true } })) return;
    await tdb.notification.create({ data: { tenantId: ctx.tenantId, userId: ctx.user.id, type, category: type === "REPORT_REVIEW" ? "LAB" : "FOLLOWUP", priority: "NORMAL", title, body: null, entityType, entityId: today, actionUrl: type === "REPORT_REVIEW" ? "/lab/reports" : type === "RECALL_DUE" ? "/followups" : "/followups" } });
  };
  const open = { status: { in: [...OPEN_STATUSES] } };
  if (ctx.permissions.has("followups.view")) {
    const sc = scopeWhere(ctx);
    const [due, overdue] = await Promise.all([tdb.followUp.count({ where: { AND: [sc, open, { dueDate: today }] } }), tdb.followUp.count({ where: { AND: [sc, open, { dueDate: { lt: today } }] } })]);
    await make("FOLLOW_UP_DUE", due, `${due} follow-up${due === 1 ? " is" : "s are"} due today.`, "followup_digest");
    await make("FOLLOW_UP_OVERDUE", overdue, `${overdue} follow-up${overdue === 1 ? " is" : "s are"} overdue.`, "followup_digest");
  }
  if (ctx.permissions.has("recalls.manage")) {
    const n = await tdb.recall.count({ where: { status: "ACTIVE", dueDate: { lte: today }, ...(ctx.user.role === "DOCTOR" ? { OR: [{ doctorUserId: ctx.user.id }, { createdById: ctx.user.id }] } : {}) } });
    await make("RECALL_DUE", n, `${n} patient recall${n === 1 ? " is" : "s are"} due.`, "recall_digest");
  }
  if (ctx.user.role === "DOCTOR" && ctx.permissions.has("tests.view")) {
    const n = await tdb.labReport.count({ where: { doctorUserId: ctx.user.id, currentVersion: { gt: 0 }, order: { is: { status: { not: "DOCTOR_REVIEWED" } } } } });
    await make("REPORT_REVIEW", n, n === 1 ? "Report review required." : `${n} reports need your review.`, "report_digest");
  }
}
