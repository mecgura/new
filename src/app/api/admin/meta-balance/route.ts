import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { addFundsSchema, addMetaFunds, lowAlertSchema, metaBalanceOverview, removeMetaFunds, setLowAlert } from "@/services/meta-balance";

/** Estimated money left with Meta per WhatsApp Business account (top-ups recorded here minus estimated spend). */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok(await metaBalanceOverview());
});

/** Records a top-up made in Meta Business Suite. */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const input = await readJson(req, addFundsSchema);
  await addMetaFunds(input);
  await audit({ action: "wallet.settings_updated", actorUserId: admin.id, targetType: "meta_funds", targetId: input.wabaRecordId, metadata: { amount: input.amount, date: input.date }, req });
  return ok(await metaBalanceOverview(), { status: 201 });
});

export const PUT = handle(async (req) => {
  await requireSuperAdmin(req);
  await setLowAlert((await readJson(req, lowAlertSchema)).lowAlert);
  return ok(await metaBalanceOverview());
});

export const DELETE = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const { id } = await readJson(req, z.object({ id: z.string().trim().min(1).max(64) }).strict());
  await removeMetaFunds(id);
  await audit({ action: "wallet.settings_updated", actorUserId: admin.id, targetType: "meta_funds", targetId: id, metadata: { removed: true }, req });
  return ok(await metaBalanceOverview());
});
