import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { decideDeletion } from "@/services/account/data";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ decision: z.enum(["execute", "reject"]), note: z.string().max(500).default("") }).strict();

/** Carry out (after the cooling-off period) or reject a workspace deletion request. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  return ok(await decideDeletion(admin.id, (await params).id, await readJson(req, schema), req));
});
