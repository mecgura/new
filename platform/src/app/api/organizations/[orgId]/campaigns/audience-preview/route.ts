import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { audienceSchema } from "@/lib/validations";
import { audiencePreview } from "@/services/campaigns/campaigns";
import { z } from "zod";

type Ctx = { params: Promise<{ orgId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "campaigns:read");
  const { audience } = await readJson(req, z.object({ audience: audienceSchema }));
  return ok(await audiencePreview(access, audience));
});
