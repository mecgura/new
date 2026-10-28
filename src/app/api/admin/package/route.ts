import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { getPacks, packageMargins, packsSchema, savePacks } from "@/services/billing/package";

/** Top-up packs for sale, and this month's Meta cost vs package price for every package client. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const margins = await packageMargins();
  const fin = (b: { remaining: number }) => ({ ...b, remaining: Number.isFinite(b.remaining) ? b.remaining : -1 });
  return ok({ packs: await getPacks(), clients: margins.map((m) => ({ ...m, marketing: fin(m.marketing), utility: fin(m.utility) })) });
});

export const PUT = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const { packs } = await readJson(req, packsSchema.strict());
  return ok({ packs: await savePacks(packs, admin.id, req) });
});
