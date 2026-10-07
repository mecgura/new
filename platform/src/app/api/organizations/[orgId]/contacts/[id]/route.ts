import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { updateContactSchema } from "@/lib/validations";
import { deleteContact, getContactDetail, updateContact } from "@/services/inbox/contacts";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "contacts:read");
  return ok(await getContactDetail(access.organizationId, ids.id));
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "contacts:write");
  const input = await readJson(req, updateContactSchema);
  return ok({ contact: await updateContact({ organizationId: access.organizationId, actorUserId: access.user.id, req }, ids.id, input) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "contacts:delete");
  await deleteContact({ organizationId: access.organizationId, actorUserId: access.user.id, req }, ids.id);
  return ok({ ok: true });
});
