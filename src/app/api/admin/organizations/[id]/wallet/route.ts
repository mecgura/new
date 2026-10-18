import { handle, ok, readJson, readQuery } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema, paginationSchema, walletMoveSchema, walletSettingsSchema } from "@/lib/validations";
import { creditWallet, debitWallet, getWallet, listWalletEntries, setLowBalanceThreshold } from "@/services/wallet";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const q = readQuery(req, paginationSchema);
  return ok({ wallet: await getWallet(id), ...(await listWalletEntries(id, q)) });
});

/** Add money received from the client (credit), or take some back as a correction (debit). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const input = await readJson(req, walletMoveSchema);
  const actor = { actorUserId: admin.id, req };
  const move = { amount: input.amountRupees, reference: input.reference, note: input.note, idempotencyKey: input.idempotencyKey };
  const r = input.direction === "credit" ? await creditWallet(id, actor, { ...move, reason: "topup" }) : await debitWallet(id, actor, { ...move, reason: "correction" });
  return ok({ balance: r.balance, entryId: r.entryId, replayed: r.replayed, wallet: await getWallet(id) }, { status: r.replayed ? 200 : 201 });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const input = await readJson(req, walletSettingsSchema);
  return ok({ wallet: await setLowBalanceThreshold(id, { actorUserId: admin.id, req }, input.lowBalanceRupees) });
});
