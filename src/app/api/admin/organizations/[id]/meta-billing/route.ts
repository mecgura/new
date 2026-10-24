import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { getMetaRates } from "@/services/meta-rates";
import { getMetaBilling, metaBillingSchema, setMetaBilling } from "@/services/billing/meta-billing";

type Ctx = { params: Promise<{ id: string }> };

/** Who pays Meta for this client's messages, plus the current Meta rates for the preview. */
export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  return ok({ billing: await getMetaBilling(id), rates: await getMetaRates() });
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const billing = await setMetaBilling(id, await readJson(req, metaBillingSchema), admin.id, req);
  return ok({ billing, rates: await getMetaRates() });
});
