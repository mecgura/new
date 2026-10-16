import { apiRoute, readJson } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import type { RequestContext } from "@/lib/auth/context";
import { purgeAudit, sealAudit, verifyAudit } from "@/lib/services/sec-audit";

export const dynamic = "force-dynamic";
/** { action: "seal" | "verify" | "purge", password?, reason? } — purge needs the admin's password (and authenticator code) and a reason. */
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => {
  const b = (await readJson(req)) as { action?: string; password?: string; reason?: string; limit?: number };
  if (b.action === "seal") return sealAudit(ctx); if (b.action === "verify") return verifyAudit(ctx, b.limit); if (b.action === "purge") return purgeAudit(ctx, b);
  throw new AppError("VALIDATION_ERROR", { message: "Unknown action." });
});
