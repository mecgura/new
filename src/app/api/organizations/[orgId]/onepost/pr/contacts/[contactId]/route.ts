import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { contactSchema, deleteContact, updateContact } from "@/services/onepost/pr";

type Ctx = { params: Promise<{ orgId: string; contactId: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  return ok(await updateContact(access, ids.contactId, await readJson(req, contactSchema), req));
});
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  await deleteContact(access, ids.contactId, req);
  return ok({ ok: true });
});
