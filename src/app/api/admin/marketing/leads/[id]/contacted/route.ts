import { handle, ok } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { followUpText, markContacted } from "@/services/marketing/leads";

type Ctx = { params: Promise<{ id: string }> };

/** The admin opened WhatsApp for this lead. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const lead = await markContacted(idSchema.parse((await params).id), admin.id);
  return ok({ lead, followUp: followUpText(lead) });
});
