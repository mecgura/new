import { handle, ok, readQuery } from "@/lib/api";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/session";
import { adminList } from "@/services/sponsored/sponsored";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const { status } = readQuery(req, z.object({ status: z.string().max(20).optional() }));
  return ok(await adminList(status));
});
