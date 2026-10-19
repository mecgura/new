import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { leadSourceUpdateSchema } from "@/lib/validations";
import { deleteLeadSource, updateLeadSource } from "@/services/leads/leads";

type Ctx = { params: Promise<{ orgId: string; sid: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "whatsapp:manage");
  const input = await readJson(req, leadSourceUpdateSchema);
  return ok({ source: await updateLeadSource(access, ids.sid, input) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "whatsapp:manage");
  await deleteLeadSource(access, ids.sid, req);
  return ok({ deleted: true });
});
