import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { contactNoteSchema } from "@/lib/validations";
import { addContactNote } from "@/services/inbox/contacts";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "contacts:write");
  const { body } = await readJson(req, contactNoteSchema);
  return ok({ note: await addContactNote({ organizationId: access.organizationId, actorUserId: access.user.id, req }, ids.id, body) }, { status: 201 });
});
