import { handle, ApiError } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { attachmentFor } from "@/services/support/tickets";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

/** Download a file attached to one of this workspace's tickets. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "support:use");
  const a = await attachmentFor(ids.aid, { organizationId: access.organizationId });
  if (!a) throw new ApiError("NOT_FOUND", "File not found.");
  return new Response(new Uint8Array(a.data), { headers: { "content-type": a.mimeType, "content-disposition": `attachment; filename="${a.filename.replace(/"/g, "")}"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
});
