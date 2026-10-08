import "server-only";
import type { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { canTransition } from "@/lib/subscriptions/state";
import { invalidateEntitlements } from "./entitlements";

export type Tx = Prisma.TransactionClient;
export interface Actor { id: string | null; source: "USER" | "SUPER_ADMIN" | "SYSTEM" | "WEBHOOK" }
export const SYSTEM: Actor = { id: null, source: "SYSTEM" };

export async function logEvent(tx: Tx, e: { tenantId: string; subscriptionId: string; type: string; from?: string | null; to?: string | null; fromPlanId?: string | null; toPlanId?: string | null; actor: Actor; note?: string | null }) {
  await tx.subscriptionEvent.create({ data: { tenantId: e.tenantId, subscriptionId: e.subscriptionId, type: e.type, fromStatus: e.from ?? null, toStatus: e.to ?? null, fromPlanId: e.fromPlanId ?? null, toPlanId: e.toPlanId ?? null, actorId: e.actor.id, source: e.actor.source, note: e.note?.slice(0, 300) ?? null } });
}

/**
 * THE ONLY way a subscription's status changes. It checks the documented transition table (state.ts), writes the change with a
 * compare-and-set on the previous status (so two racing requests cannot both win) and appends to the history.
 * `patch` carries the other fields that must change in the same step (periods, flags, grace dates…).
 */
export async function transition(tx: Tx, sub: { id: string; tenantId: string; status: string }, to: string, patch: Prisma.SubscriptionUncheckedUpdateManyInput, actor: Actor, note?: string) {
  if (!canTransition(sub.status, to)) throw new AppError("CONFLICT", { message: `A subscription that is ${sub.status.toLowerCase().replace("_", " ")} can't become ${to.toLowerCase().replace("_", " ")}.` });
  const r = await tx.subscription.updateMany({ where: { id: sub.id, status: sub.status }, data: { ...patch, status: to } });
  if (r.count === 0) throw new AppError("CONFLICT", { message: "The subscription changed while you were working. Refresh and try again." });
  await logEvent(tx, { tenantId: sub.tenantId, subscriptionId: sub.id, type: `STATUS_${to}`, from: sub.status, to, actor, note });
  invalidateEntitlements(sub.tenantId);
}
