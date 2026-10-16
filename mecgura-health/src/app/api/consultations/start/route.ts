import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { startConsultation } from "@/lib/services/consultation";

export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const b = (await readJson(req)) as { visitId?: unknown }; if (typeof b.visitId !== "string") throw new AppError("VALIDATION_ERROR", { message: "Choose a visit." }); return startConsultation(ctx, b.visitId); });
