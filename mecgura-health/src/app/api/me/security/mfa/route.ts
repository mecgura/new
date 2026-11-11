import { apiRoute, readJson } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import type { RequestContext } from "@/lib/auth/context";
import { beginEnrollment, confirmEnrollment, disableMfa, regenerateBackupCodes } from "@/lib/services/sec-mfa";

export const dynamic = "force-dynamic";
/** { action: begin|confirm|disable|regenerate, password?, code? } — always the signed-in user's OWN factor. */
export const POST = apiRoute<RequestContext>({}, async ({ req, ctx }) => {
  const b = (await readJson(req)) as { action?: string; password?: string; code?: string };
  if (ctx.user.role === "PATIENT") throw new AppError("FORBIDDEN");
  switch (b.action) {
    case "begin": return beginEnrollment(ctx, b.password);
    case "confirm": return confirmEnrollment(ctx, b.code);
    case "disable": await disableMfa(ctx, b.password, b.code); return { disabled: true };
    case "regenerate": return regenerateBackupCodes(ctx, b.password, b.code);
    default: throw new AppError("VALIDATION_ERROR", { message: "Unknown action." });
  }
});
