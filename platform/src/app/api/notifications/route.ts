import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { paginationSchema } from "@/lib/validations";
import { listNotifications, markAllRead } from "@/lib/notifications";

const querySchema = paginationSchema.extend({ unread: z.enum(["1", "0"]).optional() });

export const GET = handle(async (req) => {
  const user = await requireUser();
  const q = readQuery(req, querySchema);
  const data = await listNotifications(user.id, { page: q.page, pageSize: q.pageSize, unreadOnly: q.unread === "1" });
  return ok({ ...data, page: q.page, pageSize: q.pageSize });
});

/** Mark all as read. */
export const POST = handle(async () => {
  const user = await requireUser();
  return ok({ ok: true, updated: await markAllRead(user.id) });
});
