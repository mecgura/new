import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { segmentSchema } from "@/lib/validations";
import { createSegment, listSegments } from "@/services/campaigns/audience";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "campaigns:read");
  return ok({ segments: await listSegments(access.organizationId) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "campaigns:manage");
  const input = await readJson(req, segmentSchema);
  const s = await createSegment(access, input, req);
  return ok({ segment: { id: s.id, name: s.name } }, { status: 201 });
});
