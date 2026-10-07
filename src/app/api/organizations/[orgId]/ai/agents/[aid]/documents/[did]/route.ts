import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deleteDocument } from "@/services/ai/agents";

type Ctx = { params: Promise<{ orgId: string; aid: string; did: string }> };

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "ai:manage");
  await deleteDocument(access, ids.aid, ids.did);
  return ok({ ok: true });
});
