import { handle } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { assetFile } from "@/services/social/assets";

type Ctx = { params: Promise<{ orgId: string; assetId: string }> };

/** The image itself, for team members only (posts copy the bytes, so publishing never depends on this URL). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "social:manage");
  const a = await assetFile(access.organizationId, ids.assetId);
  return new Response(new Uint8Array(a.bytes), { headers: { "content-type": a.mimeType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
});
