import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { changeUserRole, resetAccess, setUserStatus } from "@/lib/services/platform-users";

export const dynamic = "force-dynamic";
/** Body: { action: "status" | "role" | "reset", ... }. Sensitive actions need the Super Admin's own password. */
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => {
  const b = (await readJson(req)) as Record<string, string | undefined>;
  if (b.action === "status") return setUserStatus(ctx, params.id, { status: b.status ?? "", notes: b.notes, password: b.password });
  if (b.action === "role") return changeUserRole(ctx, params.id, { role: b.role ?? "", notes: b.notes, password: b.password });
  if (b.action === "reset") return resetAccess(ctx, params.id, { password: b.password });
  throw new AppError("VALIDATION_ERROR", { message: "Unknown action." });
});
