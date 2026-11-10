import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { resetMetaConnections } from "@/services/admin/meta-reset";

const schema = z.object({ confirm: z.literal("RESET") });

/** Super admin only. Wipes saved Meta tokens and links platform-wide (history is kept). */
export const POST = handle(async (req) => {
  const user = await requireSuperAdmin(req);
  await readJson(req, schema);
  return ok(await resetMetaConnections({ userId: user.id, req }));
});
