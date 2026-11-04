import { handle, ok, readJson } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { adminGet, adminReply, adminReplySchema, adminUpdate, adminUpdateSchema } from "@/services/support/tickets";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 30;

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  return ok({ ticket: await adminGet(idSchema.parse((await params).id)) });
});

/** Reply to the client, or add an internal note. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  return ok({ ticket: await adminReply({ userId: admin.id, req }, idSchema.parse((await params).id), await readJson(req, adminReplySchema)) });
});

/** Status, priority (moves the deadline while unanswered) or assignee. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  return ok({ ticket: await adminUpdate({ userId: admin.id, req }, idSchema.parse((await params).id), await readJson(req, adminUpdateSchema)) });
});
