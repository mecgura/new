import { z } from "zod";
import { handle, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { exportRelease } from "@/services/onepost/pr";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };
const query = z.object({ format: z.enum(["pdf", "docx"]).default("pdf") });

/** The press release as a PDF or Word file, ready to attach to an email. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:read");
  const f = await exportRelease(access, ids.postId, readQuery(req, query).format);
  return new Response(Buffer.from(f.bytes), { headers: { "content-type": f.type, "content-disposition": `attachment; filename="${f.name}"`, "cache-control": "no-store" } });
});
