import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { idSchema } from "@/lib/validations";
import { previewChange } from "@/services/billing/billing";

type Ctx = { params: Promise<{ orgId: string }> };

/** What would happen if you chose this plan — changes nothing. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:read");
  const { planId } = readQuery(req, z.object({ planId: idSchema }));
  return ok({ preview: await previewChange(access.organizationId, planId) });
});
