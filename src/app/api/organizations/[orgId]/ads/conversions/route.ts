import { z } from "zod";
import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getConversionSummary, setAdConversions } from "@/services/ads/conversions";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
const body = z.object({ enabled: z.boolean() });

/** Qualified leads and sales from ads that were reported back to Meta. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "analytics:read");
  return ok(await getConversionSummary(access.organizationId, readQuery(req, query).days));
});

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "ads:manage");
  return ok(await setAdConversions(access.organizationId, (await readJson(req, body)).enabled));
});
