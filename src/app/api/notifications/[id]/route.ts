import { ApiError, handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { markRead } from "@/lib/notifications";

type Ctx = { params: Promise<{ id: string }> };

/** Mark one notification as read (only the owner's own notifications). */
export const PATCH = handle<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  const id = idSchema.parse((await params).id);
  if (!(await markRead(user.id, id))) throw new ApiError("NOT_FOUND", "Notification not found.");
  return ok({ ok: true });
});
