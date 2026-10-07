import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { contactListSchema, createContactSchema } from "@/lib/validations";
import { createContact, listContacts } from "@/services/inbox/contacts";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "contacts:read");
  const q = readQuery(req, contactListSchema);
  const data = await listContacts(access.organizationId, { ...q, tagId: q.tagId || undefined, leadStatus: q.leadStatus || undefined, ownerUserId: q.ownerUserId || undefined });
  return ok({ ...data, page: q.page, pageSize: q.pageSize });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "contacts:write");
  const input = await readJson(req, createContactSchema);
  return ok({ contact: await createContact({ organizationId: access.organizationId, actorUserId: access.user.id, req }, input) }, { status: 201 });
});
