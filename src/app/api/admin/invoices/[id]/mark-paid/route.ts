import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { recordManualPayment } from "@/services/billing/billing";

type Ctx = { params: Promise<{ id: string }> };

/** Record money that was actually received (bank transfer, UPI, cheque). A reference is required. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const { reference } = await readJson(req, z.object({ reference: z.string().trim().min(3, "Enter the payment reference").max(100) }));
  return ok({ invoice: await recordManualPayment(admin.id, id, { reference }, req) });
});
