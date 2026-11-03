import { z } from "zod";
import { handle, ok, readJson, readQuery } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { createPost, listMonth, monthSchema, postSchema } from "@/services/marketing/content";

/** MECGURA's content calendar for a month, with that month's festivals. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return ok(await listMonth(readQuery(req, z.object({ month: monthSchema })).month));
});

export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  return ok({ post: await createPost(await readJson(req, postSchema), admin.id, req) }, { status: 201 });
});
