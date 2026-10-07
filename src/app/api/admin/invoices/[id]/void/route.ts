import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { voidInvoice } from "@/services/billing/billing";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  await voidInvoice(admin.id, idSchema.parse((await params).id), req);
  return ok({ ok: true });
});
