import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema, resetAccessSchema } from "@/lib/validations";
import { resetClientAccess } from "@/lib/services/clients";

type Ctx = { params: Promise<{ id: string }> };

/** Returns a generated temporary password ONCE (response is no-store). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const input = await readJson(req, resetAccessSchema);
  return ok(await resetClientAccess(admin.id, id, input, req));
});
