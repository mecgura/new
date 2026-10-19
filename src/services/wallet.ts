import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { formatINR } from "@/lib/catalog";

/**
 * Prepaid MECGURA service credit (model C). All amounts are paise.
 * The balance only changes together with a ledger entry inside one transaction, debits can never take it below zero,
 * and an idempotency key makes a retried credit/debit a no-op.
 */

export const MAX_WALLET_AMOUNT = 100_000_000; // ₹10,00,000 per entry

export type WalletActor = { actorUserId: string | null; req?: Request };

export type WalletEntryView = {
  id: string;
  direction: "credit" | "debit";
  amount: number;
  balanceAfter: number;
  reason: string;
  note: string;
  reference: string;
  createdAt: Date;
  createdBy: string | null;
};

export type WalletView = { balance: number; currency: string; lowBalanceThreshold: number; low: boolean };

const toView = (w: { balance: number; currency: string; lowBalanceThreshold: number }): WalletView => ({
  balance: w.balance,
  currency: w.currency,
  lowBalanceThreshold: w.lowBalanceThreshold,
  low: w.lowBalanceThreshold > 0 && w.balance <= w.lowBalanceThreshold,
});

async function ensureOrg(organizationId: string) {
  if (!(await db.organization.count({ where: { id: organizationId } }))) throw new ApiError("NOT_FOUND", "Client not found.");
}

/** The wallet row for a client; created on first use with a zero balance. */
export async function getWallet(organizationId: string): Promise<WalletView> {
  await ensureOrg(organizationId);
  const w = await db.wallet.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
  return toView(w);
}

export async function listWalletEntries(organizationId: string, opts: { page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const where = { organizationId };
  const [total, rows] = await Promise.all([
    db.walletEntry.count({ where }),
    db.walletEntry.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const ids = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => Boolean(x)))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));
  const entries: WalletEntryView[] = rows.map((r) => ({
    id: r.id,
    direction: r.direction === "debit" ? "debit" : "credit",
    amount: r.amount,
    balanceAfter: r.balanceAfter,
    reason: r.reason,
    note: r.note,
    reference: r.reference,
    createdAt: r.createdAt,
    createdBy: r.createdById ? (nameOf.get(r.createdById) ?? null) : null,
  }));
  return { entries, total, page, pageSize };
}

type Move = { amount: number; reason: "topup" | "correction" | "usage" | "refund"; note?: string; reference?: string; idempotencyKey?: string };

function assertAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new ApiError("VALIDATION_ERROR", "Amount must be a positive number.", { details: { amount: ["Enter an amount above zero"] } });
  if (amount > MAX_WALLET_AMOUNT) throw new ApiError("VALIDATION_ERROR", "Amount is too large for one entry.", { details: { amount: ["Maximum ₹10,00,000 per entry"] } });
}

/** An entry with this idempotency key already exists → return it instead of applying the movement twice. */
async function existing(organizationId: string, key: string | undefined) {
  if (!key) return null;
  const e = await db.walletEntry.findUnique({ where: { idempotencyKey: key } });
  if (!e) return null;
  if (e.organizationId !== organizationId) throw new ApiError("CONFLICT", "This request id was already used.");
  return e;
}

async function move(organizationId: string, direction: "credit" | "debit", m: Move, createdById: string | null) {
  assertAmount(m.amount);
  await ensureOrg(organizationId);
  const done = await existing(organizationId, m.idempotencyKey);
  if (done) return { entryId: done.id, balance: done.balanceAfter, replayed: true };
  try {
    return await db.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
      let balanceAfter: number;
      if (direction === "credit") {
        balanceAfter = (await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: m.amount } } })).balance;
      } else {
        // Conditional update: two concurrent debits can never take the balance below zero.
        const r = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: m.amount } }, data: { balance: { decrement: m.amount } } });
        if (r.count === 0) throw new ApiError("CONFLICT", `Not enough wallet balance (${formatINR(wallet.balance)} available, ${formatINR(m.amount)} needed).`);
        balanceAfter = (await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).balance;
      }
      const entry = await tx.walletEntry.create({
        data: {
          walletId: wallet.id,
          organizationId,
          direction,
          amount: m.amount,
          balanceAfter,
          reason: m.reason,
          note: (m.note ?? "").slice(0, 300),
          reference: (m.reference ?? "").slice(0, 100),
          idempotencyKey: m.idempotencyKey ?? null,
          createdById,
        },
      });
      return { entryId: entry.id, balance: balanceAfter, replayed: false };
    });
  } catch (e) {
    // Two identical requests raced: the loser hits the unique key and returns the winner's entry.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && m.idempotencyKey) {
      const won = await existing(organizationId, m.idempotencyKey);
      if (won) return { entryId: won.id, balance: won.balanceAfter, replayed: true };
    }
    throw e;
  }
}

/** Admin: money received from the client (UPI / bank) is added as wallet credit. */
export async function creditWallet(organizationId: string, actor: WalletActor, input: Omit<Move, "reason"> & { reason?: "topup" | "correction" | "refund" }) {
  const r = await move(organizationId, "credit", { ...input, reason: input.reason ?? "topup" }, actor.actorUserId);
  if (!r.replayed) {
    await audit({ action: "wallet.credited", actorUserId: actor.actorUserId, organizationId, targetType: "wallet_entry", targetId: r.entryId, metadata: { amount: input.amount, reason: input.reason ?? "topup", reference: input.reference ?? "" }, req: actor.req });
    await notifyOwners(organizationId, "Wallet credited", `${formatINR(input.amount)} was added to your wallet. Balance: ${formatINR(r.balance)}.`);
  }
  return r;
}

/** Admin correction, or (later) message usage. Refused when the balance isn't enough. */
export async function debitWallet(organizationId: string, actor: WalletActor | null, input: Omit<Move, "reason"> & { reason?: "correction" | "usage" }) {
  const r = await move(organizationId, "debit", { ...input, reason: input.reason ?? "correction" }, actor?.actorUserId ?? null);
  if (!r.replayed) {
    // Per-message usage is already in the ledger; auditing every message would only add noise.
    if ((input.reason ?? "correction") !== "usage") await audit({ action: "wallet.debited", actorUserId: actor?.actorUserId ?? null, organizationId, targetType: "wallet_entry", targetId: r.entryId, metadata: { amount: input.amount, reason: input.reason ?? "correction" }, req: actor?.req });
    const w = await db.wallet.findUnique({ where: { organizationId } });
    if (w && w.lowBalanceThreshold > 0 && w.balance <= w.lowBalanceThreshold && w.balance + input.amount > w.lowBalanceThreshold) {
      await notifyOwners(organizationId, "Wallet balance is low", `Your wallet balance is ${formatINR(w.balance)}. Ask MECGURA to add credit so sending isn't interrupted.`);
    }
  }
  return r;
}

export async function setLowBalanceThreshold(organizationId: string, actor: WalletActor, threshold: number) {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > MAX_WALLET_AMOUNT) throw new ApiError("VALIDATION_ERROR", "Enter a valid amount.", { details: { threshold: ["Enter 0 or a positive amount"] } });
  await ensureOrg(organizationId);
  const w = await db.wallet.upsert({ where: { organizationId }, update: { lowBalanceThreshold: threshold }, create: { organizationId, lowBalanceThreshold: threshold } });
  await audit({ action: "wallet.settings_updated", actorUserId: actor.actorUserId, organizationId, targetType: "wallet", targetId: w.id, metadata: { lowBalanceThreshold: threshold }, req: actor.req });
  return toView(w);
}

async function notifyOwners(organizationId: string, title: string, body: string) {
  const owners = await db.organizationMember.findMany({ where: { organizationId, role: { in: ["CLIENT_OWNER", "MANAGER"] } }, select: { userId: true } });
  await Promise.all(owners.map((o) => notify({ userId: o.userId, organizationId, type: "info", title, body, link: "/billing?tab=wallet" })));
}
