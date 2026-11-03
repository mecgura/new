import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { autoPlan, monthSchema } from "@/services/marketing/content";

/** Fills the month's empty days with ready post ideas and festival posts. */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  return ok(await autoPlan((await readJson(req, z.object({ month: monthSchema }).strict())).month, admin.id, req));
});
