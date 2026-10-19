import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { packApplySchema } from "@/lib/validations";
import { applyPack, listPacks } from "@/services/packs";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await orgRoute(req, params, "org:read");
  return ok({ packs: listPacks() });
});

/** Adds a pack's starter tags, a draft AI agent and unsubmitted template drafts. Nothing is sent to customers. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "whatsapp:manage");
  enforceRateLimit(`pack:${access.user.id}`, 10, 15 * 60_000);
  const input = await readJson(req, packApplySchema);
  return ok(await applyPack(access, input.packId, req), { status: 201 });
});
