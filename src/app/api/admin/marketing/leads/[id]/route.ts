import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { deleteLead, followUpText, getLead, updateLead, updateLeadSchema } from "@/services/marketing/leads";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  const lead = await getLead(idSchema.parse((await params).id));
  return ok({ lead, followUp: followUpText(lead) });
});

/** Stage, follow-up date, value, details, or a note. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const lead = await updateLead(idSchema.parse((await params).id), await readJson(req, updateLeadSchema), admin.id, req);
  return ok({ lead, followUp: followUpText(lead) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  await deleteLead(idSchema.parse((await params).id), admin.id, req);
  return ok({ ok: true });
});
