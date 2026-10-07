import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { noteSchema } from "@/lib/validations";
import { addInternalNote } from "@/services/inbox/messaging";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

/** Internal note — visible to the team only, never sent to WhatsApp. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:note");
  const { body } = await readJson(req, noteSchema);
  return ok({ message: await addInternalNote(access, ids.cid, body) }, { status: 201 });
});
