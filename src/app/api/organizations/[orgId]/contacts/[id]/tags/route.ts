import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { contactTagsSchema } from "@/lib/validations";
import { setContactTags } from "@/services/inbox/contacts";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "contacts:write");
  const { tags } = await readJson(req, contactTagsSchema);
  return ok({ tags: await setContactTags({ organizationId: access.organizationId, actorUserId: access.user.id, req }, ids.id, tags) });
});
